// Aplica a aparência salva antes da primeira pintura (evita piscar).
// "sat" (padrão) = tokens do tema escuro + modo satélite: imagem nítida no fundo de todas as telas.
(() => {
  let t = "sat";
  try {
    t = JSON.parse(localStorage.getItem("clima-theme")) || "sat";
    if (!localStorage.getItem("clima-sat-default")) { t = "sat"; localStorage.setItem("clima-theme", '"sat"'); localStorage.setItem("clima-sat-default", "1"); }
  } catch (e) {}
  const d = document.documentElement;
  if (t === "sat") { d.dataset.theme = "dark"; d.dataset.mode = "sat"; }
  else if (t === "light" || t === "dark") d.dataset.theme = t;
})();
