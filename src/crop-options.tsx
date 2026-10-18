import React from "react";
export function CropOptions() {
  return (
    <>
      <option value="free">Free · AI choice</option>
      <option value="original">Original ratio · AI reframe</option>
      <option value="1:1">Square · 1:1</option>
      <option value="4:5">8×10 · 4:5</option>
      <option value="3:2">4×6 · 2:3</option>
      <option value="5:7">5:7</option>
      <option value="4:5-portrait">Social portrait · 4:5</option>
      <option value="9:16">Vertical · 9:16</option>
      <option value="16:9">16:9 · Widescreen</option>
    </>
  );
}
