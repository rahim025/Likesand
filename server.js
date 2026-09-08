require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

// ============================================================
// Connexion base de données — fonctionne avec Supabase, Railway, Render Postgres, etc.
// ============================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// ============================================================
// Envoi de SMS (codes OTP) — point d'intégration à brancher sur un vrai
// fournisseur (Kkiapay, FedaPay, Vonage, Twilio, un fournisseur SMS local...).
// ⚠️ Tant que ce n'est pas branché, le code OTP est seulement affiché dans
// les logs du serveur (utile en développement, à retirer avant la mise en
// production).
// ============================================================
async function sendSms(phoneNumber, message) {
  // Exemple de structure d'appel (pseudo-code, à adapter au fournisseur choisi) :
  //
  // await fetch("https://api.fournisseur-sms.com/v1/send", {
  //   method: "POST",
  //   headers: { Authorization: `Bearer ${process.env.SMS_API_KEY}` },
  //   body: JSON.stringify({ to: phoneNumber, text: message }),
  // });

  console.log(`[SMS -> ${phoneNumber}] ${message}`);
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000)); // code à 6 chiffres
}

// ============================================================
// Middleware d'authentification JWT
// ============================================================
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Connexion requise." });
  }

  const token = header.split(" ")[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Session invalide, reconnecte-toi." });
  }
}

// ============================================================
// App Express
// ============================================================
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || "*" }));
app.use(express.json());

// Limite le nombre de requêtes pour freiner les bots qui likent en boucle
const likeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // max 20 actions/minute par IP
  message: { error: "Trop de requêtes, ralentis un peu." },
});
app.use("/api/photos", likeLimiter);

const OTP_TTL_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const MIN_WITHDRAWAL_FCFA = 500; // seuil minimum, à adapter selon les frais de l'agrégateur

// ============================================================
// AUTH : inscription, connexion, mot de passe oublié
// ============================================================

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  const {
    phone_number,
    full_name,
    password,
    operator,
    payout_phone_number,
    payout_operator,
  } = req.body;

  if (!phone_number || !full_name || !password || !operator) {
    return res.status(400).json({ error: "Tous les champs sont requis." });
  }
  if (!["mtn_momo", "moov_money"].includes(operator)) {
    return res.status(400).json({ error: "Opérateur invalide." });
  }

  // Si l'utilisateur ne précise pas de numéro de réception distinct,
  // l'argent est envoyé sur le numéro de connexion par défaut.
  const finalPayoutPhone = payout_phone_number || phone_number;
  const finalPayoutOperator = payout_operator || operator;
  if (!["mtn_momo", "moov_money"].includes(finalPayoutOperator)) {
    return res.status(400).json({ error: "Opérateur de réception invalide." });
  }

  try {
    const existing = await pool.query(
      "select id from users where phone_number = $1",
      [phone_number]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Ce numéro est déjà inscrit." });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `insert into users
         (phone_number, full_name, password_hash, operator, payout_phone_number, payout_operator)
       values ($1, $2, $3, $4, $5, $6)
       returning id, phone_number, full_name, operator, payout_phone_number, payout_operator, balance_fcfa`,
      [phone_number, full_name, password_hash, operator, finalPayoutPhone, finalPayoutOperator]
    );

    // TODO: envoyer un code OTP par SMS ici (ex. via un agrégateur comme Kkiapay/Twilio)
    // et ne passer is_verified à true qu'après validation du code.

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    res.status(201).json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const { phone_number, password } = req.body;

  try {
    const result = await pool.query(
      "select * from users where phone_number = $1",
      [phone_number]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Numéro ou mot de passe incorrect." });
    }
    if (user.is_blocked) {
      return res.status(403).json({ error: "Compte suspendu. Contacte le support." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Numéro ou mot de passe incorrect." });
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "30d",
    });

    delete user.password_hash;
    res.json({ user, token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
  }
});

// POST /api/auth/forgot-password — envoie un code OTP par SMS
app.post("/api/auth/forgot-password", async (req, res) => {
  const { phone_number } = req.body;
  if (!phone_number) {
    return res.status(400).json({ error: "Numéro de téléphone requis." });
  }

  try {
    const userResult = await pool.query(
      "select id from users where phone_number = $1",
      [phone_number]
    );

    // Réponse identique que le compte existe ou non, pour ne pas révéler
    // quels numéros sont inscrits sur la plateforme.
    if (userResult.rows.length === 0) {
      return res.json({
        message: "Si ce numéro est inscrit, un code a été envoyé.",
      });
    }

    // Anti-spam : empêche de redemander un code trop souvent
    const recent = await pool.query(
      `select created_at from password_resets
       where phone_number = $1
       order by created_at desc limit 1`,
      [phone_number]
    );
    if (recent.rows[0]) {
      const secondsSinceLast =
        (Date.now() - new Date(recent.rows[0].created_at).getTime()) / 1000;
      if (secondsSinceLast < OTP_RESEND_COOLDOWN_SECONDS) {
        return res.status(429).json({
          error: `Attends ${Math.ceil(
            OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLast
          )} secondes avant de redemander un code.`,
        });
      }
    }

    const otpCode = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await pool.query(
      "insert into password_resets (phone_number, otp_code, expires_at) values ($1, $2, $3)",
      [phone_number, otpCode, expiresAt]
    );

    await sendSms(
      phone_number,
      `Fanzy : ton code de réinitialisation est ${otpCode}. Il expire dans ${OTP_TTL_MINUTES} minutes.`
    );

    res.json({ message: "Si ce numéro est inscrit, un code a été envoyé." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
  }
});

// POST /api/auth/reset-password — vérifie le code OTP et change le mot de passe
app.post("/api/auth/reset-password", async (req, res) => {
  const { phone_number, otp_code, new_password } = req.body;

  if (!phone_number || !otp_code || !new_password) {
    return res.status(400).json({ error: "Tous les champs sont requis." });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: "Le mot de passe doit faire 6 caractères minimum." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const resetResult = await client.query(
      `select id from password_resets
       where phone_number = $1 and otp_code = $2
         and used = false and expires_at > now()
       order by created_at desc limit 1
       for update`,
      [phone_number, otp_code]
    );

    if (resetResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Code invalide ou expiré." });
    }

    const password_hash = await bcrypt.hash(new_password, 10);
    await client.query(
      "update users set password_hash = $1 where phone_number = $2",
      [password_hash, phone_number]
    );

    await client.query(
      "update password_resets set used = true where id = $1",
      [resetResult.rows[0].id]
    );

    await client.query("COMMIT");
    res.json({ message: "Mot de passe mis à jour, tu peux te connecter." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur, réessaie plus tard." });
  } finally {
    client.release();
  }
});

// ============================================================
// PHOTOS & LIKES
// ============================================================

// GET /api/photos — liste des photos actives que l'utilisateur n'a pas encore aimées
app.get("/api/photos", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `select p.id, p.image_url, p.caption, p.reward_fcfa
       from photos p
       where p.is_active = true
         and p.budget_remaining_fcfa >= p.reward_fcfa
         and not exists (
           select 1 from likes l where l.photo_id = p.id and l.user_id = $1
         )
       order by p.created_at desc
       limit 30`,
      [req.userId]
    );
    res.json({ photos: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// POST /api/photos/:id/like — enregistre un like et crédite le solde
app.post("/api/photos/:id/like", requireAuth, async (req, res) => {
  const photoId = req.params.id;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verrouille la ligne photo pour éviter les doubles dépenses en cas de requêtes simultanées
    const photoResult = await client.query(
      "select * from photos where id = $1 and is_active = true for update",
      [photoId]
    );
    const photo = photoResult.rows[0];
    if (!photo) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Photo introuvable ou campagne terminée." });
    }
    if (photo.budget_remaining_fcfa < photo.reward_fcfa) {
      await client.query("ROLLBACK");
      return res.status(410).json({ error: "Le budget de cette campagne est épuisé." });
    }

    // Empêche un like en double (contrainte unique en filet de sécurité)
    const already = await client.query(
      "select 1 from likes where user_id = $1 and photo_id = $2",
      [req.userId, photoId]
    );
    if (already.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Tu as déjà aimé cette photo." });
    }

    const reward = photo.reward_fcfa;

    await client.query(
      "insert into likes (user_id, photo_id, reward_fcfa) values ($1, $2, $3)",
      [req.userId, photoId, reward]
    );

    await client.query(
      "update photos set budget_remaining_fcfa = budget_remaining_fcfa - $1 where id = $2",
      [reward, photoId]
    );

    await client.query(
      "update users set balance_fcfa = balance_fcfa + $1 where id = $2",
      [reward, req.userId]
    );

    await client.query(
      "insert into transactions (user_id, type, amount_fcfa, reference_id) values ($1, 'like_reward', $2, $3)",
      [req.userId, reward, photoId]
    );

    await client.query("COMMIT");
    res.json({ message: "Photo aimée !", reward_fcfa: reward });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  } finally {
    client.release();
  }
});

// ============================================================
// PORTEFEUILLE
// ============================================================

// GET /api/wallet — solde actuel
app.get("/api/wallet", requireAuth, async (req, res) => {
  const result = await pool.query(
    "select balance_fcfa from users where id = $1",
    [req.userId]
  );
  res.json({ balance_fcfa: result.rows[0]?.balance_fcfa ?? 0 });
});

// GET /api/wallet/history — historique des transactions
app.get("/api/wallet/history", requireAuth, async (req, res) => {
  const result = await pool.query(
    `select type, amount_fcfa, created_at from transactions
     where user_id = $1 order by created_at desc limit 100`,
    [req.userId]
  );
  res.json({ transactions: result.rows });
});

// ============================================================
// PROFIL (numéro de réception d'argent)
// ============================================================

// GET /api/profile
app.get("/api/profile", requireAuth, async (req, res) => {
  const result = await pool.query(
    `select full_name, phone_number, operator, payout_phone_number, payout_operator, balance_fcfa
     from users where id = $1`,
    [req.userId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Compte introuvable." });
  }
  res.json({ profile: result.rows[0] });
});

// PUT /api/profile/payout — modifie le numéro qui reçoit l'argent
app.put("/api/profile/payout", requireAuth, async (req, res) => {
  const { payout_phone_number, payout_operator } = req.body;

  if (!payout_phone_number || !payout_operator) {
    return res.status(400).json({ error: "Numéro et opérateur requis." });
  }
  if (!["mtn_momo", "moov_money"].includes(payout_operator)) {
    return res.status(400).json({ error: "Opérateur invalide." });
  }

  await pool.query(
    "update users set payout_phone_number = $1, payout_operator = $2 where id = $3",
    [payout_phone_number, payout_operator, req.userId]
  );

  res.json({ message: "Numéro de réception mis à jour." });
});

// ============================================================
// RETRAIT vers MTN MoMo / Moov Money
// ============================================================

// POST /api/withdraw
app.post("/api/withdraw", requireAuth, async (req, res) => {
  let { amount_fcfa, phone_number, operator } = req.body;

  if (!amount_fcfa) {
    return res.status(400).json({ error: "Le montant est requis." });
  }
  if (amount_fcfa < MIN_WITHDRAWAL_FCFA) {
    return res.status(400).json({
      error: `Le retrait minimum est de ${MIN_WITHDRAWAL_FCFA} FCFA.`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "select balance_fcfa, payout_phone_number, payout_operator from users where id = $1 for update",
      [req.userId]
    );
    const user = userResult.rows[0];
    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Compte introuvable." });
    }

    // Si l'utilisateur ne précise rien, on utilise le numéro déjà enregistré
    // sur son compte. S'il précise un nouveau numéro/opérateur, on l'enregistre
    // comme nouveau numéro par défaut pour la prochaine fois.
    phone_number = phone_number || user.payout_phone_number;
    operator = operator || user.payout_operator;

    if (!phone_number || !operator || !["mtn_momo", "moov_money"].includes(operator)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Numéro ou opérateur de réception invalide." });
    }

    if (user.balance_fcfa < amount_fcfa) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Solde insuffisant." });
    }

    if (
      phone_number !== user.payout_phone_number ||
      operator !== user.payout_operator
    ) {
      await client.query(
        "update users set payout_phone_number = $1, payout_operator = $2 where id = $3",
        [phone_number, operator, req.userId]
      );
    }

    // Débite le solde immédiatement pour éviter les doubles demandes
    await client.query(
      "update users set balance_fcfa = balance_fcfa - $1 where id = $2",
      [amount_fcfa, req.userId]
    );

    const withdrawalResult = await client.query(
      `insert into withdrawals (user_id, amount_fcfa, operator, phone_number, status)
       values ($1, $2, $3, $4, 'pending') returning id`,
      [req.userId, amount_fcfa, operator, phone_number]
    );
    const withdrawalId = withdrawalResult.rows[0].id;

    await client.query(
      "insert into transactions (user_id, type, amount_fcfa, reference_id) values ($1, 'withdrawal', $2, $3)",
      [req.userId, -amount_fcfa, withdrawalId]
    );

    await client.query("COMMIT");

    // Déclenche le paiement réel via l'agrégateur choisi (hors transaction SQL,
    // car c'est un appel réseau externe).
    processPayout(withdrawalId, { amount_fcfa, phone_number, operator }).catch((err) =>
      console.error("Erreur de paiement agrégateur :", err)
    );

    res.status(202).json({
      message: "Demande de retrait enregistrée, traitement en cours.",
      withdrawal_id: withdrawalId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "Erreur serveur." });
  } finally {
    client.release();
  }
});

// Appelle l'API de l'agrégateur de paiement (Kkiapay / FedaPay / CinetPay).
// ⚠️ À compléter avec les identifiants réels de ton compte marchand.
// Chaque agrégateur a sa propre API de "transfert" ou "disbursement" —
// consulte leur documentation officielle pour l'implémentation exacte.
async function processPayout(withdrawalId, { amount_fcfa, phone_number, operator }) {
  try {
    // Exemple de structure d'appel (pseudo-code, à adapter à l'agrégateur choisi) :
    //
    // const response = await fetch("https://api.fedapay.com/v1/payouts", {
    //   method: "POST",
    //   headers: {
    //     Authorization: `Bearer ${process.env.FEDAPAY_SECRET_KEY}`,
    //     "Content-Type": "application/json",
    //   },
    //   body: JSON.stringify({
    //     amount: amount_fcfa,
    //     currency: "XOF",
    //     mode: operator === "mtn_momo" ? "mtn" : "moov",
    //     phone_number,
    //   }),
    // });
    // const data = await response.json();

    await pool.query(
      "update withdrawals set status = 'processing' where id = $1",
      [withdrawalId]
    );

    // TODO : une fois la réponse de l'agrégateur reçue (souvent via webhook,
    // pas dans cette même fonction), mettre à jour le statut à 'success' ou
    // 'failed', et en cas d'échec, RE-CRÉDITER le solde utilisateur.
  } catch (err) {
    await pool.query(
      "update withdrawals set status = 'failed' where id = $1",
      [withdrawalId]
    );
    // Recrédite le solde utilisateur car le retrait a échoué.
    const withdrawal = await pool.query(
      "select user_id, amount_fcfa from withdrawals where id = $1",
      [withdrawalId]
    );
    if (withdrawal.rows[0]) {
      await pool.query(
        "update users set balance_fcfa = balance_fcfa + $1 where id = $2",
        [withdrawal.rows[0].amount_fcfa, withdrawal.rows[0].user_id]
      );
    }
    throw err;
  }
}

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API démarrée sur le port ${PORT}`));
