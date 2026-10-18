const sharp = require("sharp");
const CONTROL_GUIDE = `OpenShoot control calibration (these are this app's controls, not Lightroom/Adobe slider equivalents):
Pipeline: upright source -> crop/rotation -> direct encoded-RGB exposure+contrast -> saturation -> temperature -> 8-bit pixels -> advanced tone/color/detail. Advanced controls cannot recover channel detail clipped in the basic stage. Zero is neutral for every control you may suggest.
Exposure [-3,3]: multiply encoded RGB by 2^exposure, NOT a scene-linear RAW exposure recovery. +0.25 multiplies by 1.189; +0.5 by 1.414; +1 by 2. A source channel 200 becomes about 238 at +0.25, clips at +0.5. Prefer 0 if the subject is already well lit.
Contrast [-100,100]: c=1+contrast/100; output=clamp(c*2^exposure*input + 128*(1-c),0,255). Pivot is encoded level 128; +10 contrast makes input 200 about 207 even at zero exposure. Exposure and contrast compound, so do not independently boost both by default.
Saturation [-100,100]: global saturation multiplier 1+saturation/100; +10 = 1.10x, -100 = grayscale. Temperature [-100,100] is not Kelvin: multiply red by 1+temperature/500 and blue by 1-temperature/500; +10 adds 2% red and removes 2% blue. Preserve colored event lighting rather than neutralizing it aggressively.
Advanced light controls [-100,100] add an equal brightness delta to RGB, based on current luminance L in [0,1]. Smooth transitions overlap: shadows acts mostly below L=.65 (strongest in dark tones); highlights above .35 (strongest near white); whites above .6; blacks below .4. Positive values BRIGHTEN their range, negative DARKEN. In particular positive blacks lifts blacks, not deepens them. Maximum brightness coefficients are shadows .28*(1-L), highlights .28*L, whites .20, blacks .18, multiplied by slider/100 and the range mask. At L=.2, shadows +20 adds approximately .038 (~10 RGB levels); at L=.8, highlights -20 subtracts approximately .038. These controls interact: avoid stacking shadows+blacks+exposure to brighten the same pixels.
Tint [-100,100]: positive moves green toward magenta: G*=1-tint/400, R/B*=1+tint/800. Vibrance changes HSL saturation by a factor 1+(vibrance/100)*(1-currentSaturation), so it targets less-saturated colors.
Texture adds fine detail by (texture/100)*1.2 times original-minus-small-blur; clarity adds wider local contrast by (clarity/100)*.8 times original-minus-large-blur. Positive values can amplify noise/halos; negative values soften. Dehaze changes luminance to (L-.5)*(1+dehaze/180)+.5-dehaze/1000; positive deepens dark tones/increases contrast and is not fence removal. Keep texture/clarity/dehaze at zero when unnecessary. Denoise/sharpening are handled separately for full Quick Preview.
Color mixer: each red/orange/yellow/green/aqua/blue/purple/magenta channel has Hue [-100,100] (up to +/-30 degrees), Saturation [-100,100] (relative multiplier), and Luminance [-100,100] (up to +/-0.25), with smooth overlapping hue masks. Use only to correct a visible color issue; avoid arbitrary shifts in uniforms or skin. Color grading offers shadow/midtone/highlight GradeHue [0,360], GradeSaturation [0,100], GradeLuminance [-100,100]. Hue selects tint (0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta); zero saturation means no tint. Grading adds a subtle hue tint weighted to that tonal range, not white balance; luminance adds up to +/-0.15 weighted by range. Natural delivery usually needs no creative grade: evaluate it, but keep saturation/luminance zero unless a subtle grade improves the scene. Do not force every section to change.
Choose a coherent minimal set of ABSOLUTE values from the supplied neutral source. Do not assume every slider needs a nonzero value. Judge the subject and illuminated surfaces separately from dark sky/background; preserve intentional night lighting. The image statistics below describe the full image, not subject exposure.`;
async function imageCalibration(input) {
  const { data, info } = await sharp(input)
    .rotate()
    .resize(320, 320, { fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });
  const light = [],
    peak = [];
  for (let i = 0; i < data.length; i += info.channels) {
    light.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    peak.push(Math.max(data[i], data[i + 1], data[i + 2]));
  }
  light.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(light[Math.floor((light.length - 1) * p)]);
  const percent = (count) => +((count / peak.length) * 100).toFixed(2);
  const clip = (stop) => peak.filter((v) => v * 2 ** stop >= 253).length;
  const baseline = clip(0);
  return {
    units:
      "encoded sRGB 0–255; resized full-frame estimates, not RAW sensor measurements",
    luminance: {
      p10: percentile(0.1),
      p50: percentile(0.5),
      p90: percentile(0.9),
      p99: percentile(0.99),
    },
    existingNearClippedChannelPercent: percent(baseline),
    exposureOnlyEstimates: [0.25, 0.5, 1].map((stops) => ({
      stops,
      nearClippedChannelPercent: percent(clip(stops)),
      additionalPercent: percent(clip(stops) - baseline),
    })),
    interpretation:
      "Use these to constrain global exposure, not to brighten the histogram to a target median. Contrast/temperature/saturation can add clipping beyond these exposure-only estimates. Highlight recovery later cannot undo it.",
  };
}
module.exports = { CONTROL_GUIDE, imageCalibration };
