-- ============================================================
-- Schéma de base de données — Plateforme "Like & Gagne"
-- Compatible PostgreSQL / Supabase
-- ============================================================

-- Extension pour générer des UUID
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- Utilisateurs
-- ------------------------------------------------------------
create table users (
    id              uuid primary key default uuid_generate_v4(),
    phone_number    varchar(20) unique not null,      -- numéro de connexion au compte
    full_name       varchar(120) not null,
    password_hash   text not null,
    operator        varchar(20) not null check (operator in ('mtn_momo', 'moov_money')),
    payout_phone_number varchar(20) not null,          -- numéro qui reçoit l'argent (peut différer du numéro de connexion)
    payout_operator varchar(20) not null check (payout_operator in ('mtn_momo', 'moov_money')),
    balance_fcfa    integer not null default 0,        -- solde en francs CFA (entier, pas de centimes)
    is_verified     boolean not null default false,    -- vérifié par SMS/OTP à l'inscription
    is_blocked      boolean not null default false,    -- pour lutter contre la fraude
    created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Photos proposées par les annonceurs
-- ------------------------------------------------------------
create table advertisers (
    id              uuid primary key default uuid_generate_v4(),
    company_name    varchar(120) not null,
    contact_email   varchar(120) not null,
    prepaid_balance_fcfa integer not null default 0,   -- budget publicitaire déposé à l'avance
    created_at      timestamptz not null default now()
);

create table photos (
    id              uuid primary key default uuid_generate_v4(),
    advertiser_id   uuid references advertisers(id) on delete cascade,
    image_url       text not null,
    caption         varchar(280),
    reward_fcfa     integer not null default 5,        -- montant payé à l'utilisateur par like (ajustable par campagne)
    budget_remaining_fcfa integer not null,             -- décrémenté à chaque like validé
    is_active       boolean not null default true,
    created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Likes (une seule fois par utilisateur et par photo)
-- ------------------------------------------------------------
create table likes (
    id              uuid primary key default uuid_generate_v4(),
    user_id         uuid not null references users(id) on delete cascade,
    photo_id        uuid not null references photos(id) on delete cascade,
    reward_fcfa     integer not null,
    created_at      timestamptz not null default now(),
    unique (user_id, photo_id)                         -- empêche de liker 10x la même photo
);

-- ------------------------------------------------------------
-- Journal des transactions (crédits et débits du solde)
-- ------------------------------------------------------------
create table transactions (
    id              uuid primary key default uuid_generate_v4(),
    user_id         uuid not null references users(id) on delete cascade,
    type            varchar(20) not null check (type in ('like_reward', 'withdrawal', 'adjustment')),
    amount_fcfa     integer not null,                  -- positif = crédit, négatif = débit
    reference_id    uuid,                               -- id du like ou du retrait concerné
    created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Demandes de retrait vers MoMo / Moov Money
-- ------------------------------------------------------------
create table withdrawals (
    id              uuid primary key default uuid_generate_v4(),
    user_id         uuid not null references users(id) on delete cascade,
    amount_fcfa     integer not null check (amount_fcfa > 0),
    operator        varchar(20) not null check (operator in ('mtn_momo', 'moov_money')),
    phone_number    varchar(20) not null,
    status          varchar(20) not null default 'pending'
                        check (status in ('pending', 'processing', 'success', 'failed')),
    provider_ref    text,                               -- référence renvoyée par Kkiapay/FedaPay/CinetPay
    created_at      timestamptz not null default now(),
    processed_at    timestamptz
);

-- ------------------------------------------------------------
-- Codes OTP pour la récupération de mot de passe
-- ------------------------------------------------------------
create table password_resets (
    id              uuid primary key default uuid_generate_v4(),
    phone_number    varchar(20) not null,
    otp_code        varchar(6) not null,
    expires_at      timestamptz not null,
    used            boolean not null default false,
    created_at      timestamptz not null default now()
);

create index idx_password_resets_phone on password_resets(phone_number);

-- ------------------------------------------------------------
-- Index utiles
-- ------------------------------------------------------------
create index idx_likes_user on likes(user_id);
create index idx_likes_photo on likes(photo_id);
create index idx_transactions_user on transactions(user_id);
create index idx_withdrawals_user on withdrawals(user_id);
create index idx_photos_active on photos(is_active) where is_active = true;
