// Remplace par l'URL de ton backend une fois déployé (ex: Render, Railway)
const API_BASE = "https://ton-backend.exemple.com/api";

const state = {
  token: localStorage.getItem("fanzy_token") || null, // ⚠️ voir note en bas du fichier
};

const $ = (id) => document.getElementById(id);

// ---------- Navigation entre onglets connexion / inscription ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    $("loginForm").classList.toggle("hidden", tab !== "login");
    $("registerForm").classList.toggle("hidden", tab !== "register");
  });
});

// ---------- Numéro de réception distinct à l'inscription ----------
$("differentPayoutCheckbox").addEventListener("change", (e) => {
  $("payoutFields").classList.toggle("hidden", !e.target.checked);
  $("payoutOperator").required = e.target.checked;
  $("payoutPhoneNumber").required = e.target.checked;
});

// ---------- Inscription ----------
$("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  $("registerError").textContent = "";

  try {
    const res = await fetch(`${API_BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Erreur d'inscription.");

    onAuthSuccess(json.token);
  } catch (err) {
    $("registerError").textContent = err.message;
  }
});

// ---------- Connexion ----------
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  $("loginError").textContent = "";

  try {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Connexion impossible.");

    onAuthSuccess(json.token);
  } catch (err) {
    $("loginError").textContent = err.message;
  }
});

function onAuthSuccess(token) {
  state.token = token;
  localStorage.setItem("fanzy_token", token);
  $("authView").classList.add("hidden");
  $("feedView").classList.remove("hidden");
  refreshWallet();
  loadFeed();
}

// ---------- Portefeuille ----------
async function refreshWallet() {
  const res = await authFetch(`${API_BASE}/wallet`);
  if (!res) return;
  const json = await res.json();
  $("walletAmount").textContent = json.balance_fcfa;
  $("modalBalance").textContent = `${json.balance_fcfa} FCFA`;
}

// ---------- Profil : numéro de réception enregistré ----------
async function loadPayoutInfo() {
  const res = await authFetch(`${API_BASE}/profile`);
  if (!res) return;
  const json = await res.json();
  $("withdrawPhoneNumber").value = json.profile.payout_phone_number;
  $("withdrawOperator").value = json.profile.payout_operator;
}

// ---------- Feed de photos ----------
async function loadFeed() {
  const res = await authFetch(`${API_BASE}/photos`);
  if (!res) return;
  const json = await res.json();
  const feed = $("photoFeed");
  feed.innerHTML = "";

  if (json.photos.length === 0) {
    $("feedEmpty").classList.remove("hidden");
    return;
  }
  $("feedEmpty").classList.add("hidden");

  json.photos.forEach((photo) => {
    const card = document.createElement("div");
    card.className = "photo-card";
    card.innerHTML = `
      <img src="${photo.image_url}" alt="${photo.caption ?? ""}" loading="lazy" />
      <div class="photo-card-body">
        <p class="photo-caption">${photo.caption ?? ""}</p>
        <button class="like-btn" data-id="${photo.id}">J'aime · +${photo.reward_fcfa} FCFA</button>
      </div>
    `;
    feed.appendChild(card);
  });

  feed.querySelectorAll(".like-btn").forEach((btn) => {
    btn.addEventListener("click", () => likePhoto(btn));
  });
}

async function likePhoto(btn) {
  btn.disabled = true;
  const photoId = btn.dataset.id;

  const res = await authFetch(`${API_BASE}/photos/${photoId}/like`, { method: "POST" });
  if (!res) return;
  const json = await res.json();

  if (!res.ok) {
    btn.disabled = false;
    alert(json.error);
    return;
  }

  btn.textContent = "Aimé ✓";
  refreshWallet();
}

// ---------- Mot de passe oublié ----------
let forgotPhoneNumber = "";

$("openForgotPassword").addEventListener("click", () => {
  $("forgotModal").classList.remove("hidden");
  $("forgotStep1").classList.remove("hidden");
  $("forgotStep2").classList.add("hidden");
});
$("closeForgot").addEventListener("click", () => $("forgotModal").classList.add("hidden"));

$("forgotStep1").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  $("forgotStep1Error").textContent = "";

  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Erreur, réessaie.");

    forgotPhoneNumber = data.phone_number;
    $("forgotPhoneDisplay").textContent = data.phone_number;
    $("forgotStep1").classList.add("hidden");
    $("forgotStep2").classList.remove("hidden");
  } catch (err) {
    $("forgotStep1Error").textContent = err.message;
  }
});

$("resendOtp").addEventListener("click", async () => {
  $("forgotStep2Error").textContent = "";
  try {
    const res = await fetch(`${API_BASE}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone_number: forgotPhoneNumber }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error);
    $("forgotStep2Error").textContent = "Nouveau code envoyé.";
    $("forgotStep2Error").style.color = "var(--teal)";
  } catch (err) {
    $("forgotStep2Error").textContent = err.message;
    $("forgotStep2Error").style.color = "";
  }
});

$("forgotStep2").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.phone_number = forgotPhoneNumber;
  $("forgotStep2Error").textContent = "";

  try {
    const res = await fetch(`${API_BASE}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "Erreur, réessaie.");

    alert("Mot de passe mis à jour ! Connecte-toi avec ton nouveau mot de passe.");
    $("forgotModal").classList.add("hidden");
  } catch (err) {
    $("forgotStep2Error").textContent = err.message;
  }
});

// ---------- Retrait ----------
$("openWithdraw").addEventListener("click", () => {
  $("withdrawModal").classList.remove("hidden");
  loadPayoutInfo();
});
$("closeWithdraw").addEventListener("click", () => $("withdrawModal").classList.add("hidden"));

$("withdrawForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target));
  data.amount_fcfa = Number(data.amount_fcfa);
  $("withdrawError").textContent = "";

  const res = await authFetch(`${API_BASE}/withdraw`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  if (!res) return;
  const json = await res.json();

  if (!res.ok) {
    $("withdrawError").textContent = json.error;
    return;
  }

  alert("Demande de retrait envoyée ! Le transfert peut prendre quelques minutes.");
  $("withdrawModal").classList.add("hidden");
  refreshWallet();
});

// ---------- Aide : fetch authentifié ----------
async function authFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("fanzy_token");
    location.reload();
    return null;
  }
  return res;
}

// ---------- Session existante ----------
if (state.token) {
  $("authView").classList.add("hidden");
  $("feedView").classList.remove("hidden");
  refreshWallet();
  loadFeed();
}

// NOTE SÉCURITÉ : localStorage est utilisé ici pour la simplicité de la démo.
// En production, préfère un cookie httpOnly + secure défini par le backend,
// plus résistant contre le vol de token par script malveillant (XSS).
