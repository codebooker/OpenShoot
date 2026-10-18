//! OpenShoot's isolated local RAW denoise worker. Never opens a LightCraft library.
#![forbid(unsafe_code)]
use std::{path::Path, time::{Duration,Instant}, io::{self,Write}};
use lightcraft_engine::{Session,catalog::PhotoId,export::{ExportOptions,export_photo}};
use serde_json::{Value,json};
fn emit(v:Value){let _=writeln!(io::stdout(),"{v}");let _=io::stdout().flush();}
fn call(s:&mut Session,cmd:&str,p:Value)->Result<Value,String>{s.execute(cmd,&p).map_err(|e|e.to_string())}
fn run()->Result<(),String>{
 let args:Vec<_>=std::env::args().skip(1).collect();
 if args.len()<3{return Err("usage: openshoot-raw install|render MODELS WORKDIR [MODEL|RAW] [auto|gpu|cpu]".into())}
 let action=args.get(0).ok_or("missing action")?; let models=args.get(1).ok_or("missing models")?; let work=args.get(2).ok_or("missing work directory")?;
 let mut s=Session::new().with_fs().with_system_clock();
 s.open_library(Path::new(work).join("library"),false).map_err(|e|e.to_string())?;
 s.set_denoise_models_dir(Some(models.into()));
 let device=args.get(4).map(String::as_str).unwrap_or("gpu");
 call(&mut s,"denoise.settings",json!({"runOn":device,"threads":2,"auto":false}))?;
 if action=="install"{
  let file=args.get(3).ok_or("missing model file")?;
  emit(json!({"phase":"Installing RAW denoise model","done":0,"total":1}));
  let result=call(&mut s,"denoise.models.install",json!({"path":file,"acknowledged":true}))?;
  emit(json!({"installed":result,"status":call(&mut s,"denoise.status",json!({}))?}));return Ok(())
 }
 if action!="render"{return Err("unknown action".into())}
 let raw=args.get(3).ok_or("missing RAW photo")?;
 let imported=call(&mut s,"library.import",json!({"paths":[raw]}))?;
 let id=imported.get("imported").and_then(Value::as_array).and_then(|a|a.first()).and_then(Value::as_u64).ok_or_else(||format!("RAW photo could not be imported: {imported}"))?;
 call(&mut s,"library.select",json!({"ids":[id],"active":id}))?;
 call(&mut s,"develop.set",json!({"control":"enhance.denoise","value":100}))?;
 call(&mut s,"denoise.queue",json!({"ids":[id],"retry":true}))?;
 let start=Instant::now();let mut last=(u64::MAX,u64::MAX);let mut final_status=Value::Null;
 while start.elapsed()<Duration::from_secs(1800){
  call(&mut s,"denoise.pump",json!({"pace":"full"}))?;
  let status=call(&mut s,"denoise.status",json!({"id":id}))?;
  let state=status.get("photo").and_then(|p|p.get("state")).and_then(Value::as_str).unwrap_or("");
  if state=="ready"{final_status=status;break}
  if ["failed","notApplicable","noModel"].contains(&state){return Err(format!("RAW denoise unavailable: {}",status["photo"]))}
  let done=status["running"]["done"].as_u64().unwrap_or(0); let total=status["running"]["total"].as_u64().unwrap_or(1).max(1);
  if last!=(done,total){emit(json!({"phase":"AI RAW denoise","done":done,"total":total,"device":status["device"]}));last=(done,total)}
  std::thread::sleep(Duration::from_millis(200));
 }
 if final_status.is_null(){return Err("RAW denoise timed out".into())}
 let options=ExportOptions::from_params(&json!({"format":"png","bitDepth":16,"metadata":"none"})).map_err(|e|e.to_string())?;
 for (name,amount) in [("clean.png",100),("plain.png",0)]{
  emit(json!({"phase":if amount==100 {"Preparing denoised photo"} else {"Preparing comparison"},"done":0,"total":1}));
  call(&mut s,"develop.set",json!({"control":"enhance.denoise","value":amount}))?;
  let encoded=export_photo(&mut s,PhotoId(id),&options,1).map_err(|e|e.to_string())?;
  std::fs::write(Path::new(work).join(name),encoded.bytes).map_err(|e|e.to_string())?;
 }
 emit(json!({"complete":true,"device":final_status["device"],"model":final_status["model"],"seconds":start.elapsed().as_secs_f64()}));Ok(())
}
fn main(){if let Err(e)=run(){emit(json!({"error":e}));std::process::exit(1)}}
