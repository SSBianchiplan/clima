/* =============================================================================
   STICKS VIRTUAIS (estilo do rádio do drone) — usados pela direção, pessoa e simulador de voo.
   Joy.make(el, rótulo) → estado {x, y} em −1…1 (y > 0 = para cima). Arrasta dentro do círculo e
   volta ao centro ao soltar; zona morta de 10 %. Aparece só em tela de toque.
   ============================================================================= */
(() => {
"use strict";
function make(el, rotulo){
  const st = {x:0, y:0}, knob = document.createElement("i"); el.classList.add("gj"); el.appendChild(knob);
  if(rotulo){ const s = document.createElement("small"); s.textContent = rotulo; el.appendChild(s); }
  let id = null;
  const mv = e => { if(e.pointerId !== id) return; const r = el.getBoundingClientRect(), R = r.width/2 - 20;
    let x = e.clientX - r.left - r.width/2, y = e.clientY - r.top - r.height/2; const d = Math.hypot(x, y); if(d > R){ x *= R/d; y *= R/d; }
    knob.style.transform = `translate(${x}px, ${y}px)`; const dz = v => Math.abs(v) < .1 ? 0 : v; st.x = dz(x/R); st.y = dz(-y/R); };
  const fim = e => { if(e.pointerId !== id) return; id = null; knob.style.transform = ""; st.x = st.y = 0; el.classList.remove("on"); };
  el.addEventListener("pointerdown", e => { e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); el.classList.add("on"); mv(e); });
  el.addEventListener("pointermove", mv); el.addEventListener("pointerup", fim); el.addEventListener("pointercancel", fim);
  return st;
}
window.Joy = {make};
})();
