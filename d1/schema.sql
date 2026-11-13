-- Administrador de proyectos en Cloudflare D1 (SQLite). Un solo dueño: sin user_id salvo en settings.
-- Fechas: TEXT 'AAAA-MM-DD'. Instantes: TEXT ISO UTC con Z (el front hace new Date(ts)).
-- Montos: REAL (se redondean a 2 decimales al escribir). Booleanos: 0/1.

PRAGMA foreign_keys = ON;

CREATE TABLE settings (
  user_id      TEXT PRIMARY KEY,
  name         TEXT NOT NULL DEFAULT '',
  tax_id       TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  email        TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  logo_path    TEXT,
  next_receipt INTEGER NOT NULL DEFAULT 1 CHECK (next_receipt > 0),
  quick_links  TEXT NOT NULL DEFAULT '["https://dash.cloudflare.com"]' -- JSON array
);

CREATE TABLE projects (
  id              INTEGER PRIMARY KEY,
  name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
  kind            TEXT NOT NULL DEFAULT 'Web' CHECK (length(trim(kind)) BETWEEN 1 AND 40),
  client          TEXT NOT NULL DEFAULT '',
  contact         TEXT NOT NULL DEFAULT '',
  url             TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'desarrollo', 'pausado', 'finalizado')),
  currency        TEXT NOT NULL DEFAULT 'ARS' CHECK (currency IN ('ARS', 'USD')),
  fee             REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  due_day         INTEGER CHECK (due_day BETWEEN 1 AND 31),
  start_date      TEXT,
  domain_renewal  TEXT,
  hosting_renewal TEXT,
  notes           TEXT NOT NULL DEFAULT '',
  contract_path   TEXT,
  icon            TEXT CHECK (icon IS NULL OR (icon LIKE 'data:image/%' AND length(icon) < 60000)),
  next_adjust     TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE payments (
  id          INTEGER PRIMARY KEY,
  -- RESTRICT: un proyecto con recibos no se borra (marcarlo "finalizado")
  project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  paid_on     TEXT NOT NULL,
  period      TEXT NOT NULL CHECK (period GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(period, 6, 2) BETWEEN '01' AND '12'),
  amount      REAL NOT NULL CHECK (amount > 0),
  currency    TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
  receipt_no  INTEGER NOT NULL UNIQUE,
  pdf_path    TEXT,
  note        TEXT NOT NULL DEFAULT '',
  voided_at   TEXT,
  void_reason TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX payments_project ON payments (project_id);

CREATE TABLE fee_changes (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  old_fee    REAL NOT NULL,
  new_fee    REAL NOT NULL
);
CREATE INDEX fee_changes_project ON fee_changes (project_id);

-- Historial de cuota automático, venga de editar el proyecto o del aumento general.
CREATE TRIGGER fee_change AFTER UPDATE OF fee ON projects
WHEN new.fee IS NOT old.fee
BEGIN
  INSERT INTO fee_changes (project_id, old_fee, new_fee) VALUES (new.id, old.fee, new.fee);
END;

CREATE TABLE expenses (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  spent_on   TEXT NOT NULL,
  concept    TEXT NOT NULL CHECK (length(trim(concept)) > 0),
  amount     REAL NOT NULL CHECK (amount > 0),
  currency   TEXT NOT NULL CHECK (currency IN ('ARS', 'USD')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX expenses_project ON expenses (project_id);

CREATE TABLE tasks (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  text       TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 500),
  done       INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX tasks_project ON tasks (project_id);

CREATE TABLE subscriptions (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL CHECK (length(trim(name)) > 0),
  amount       REAL NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency     TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('ARS', 'USD')),
  cycle        TEXT NOT NULL DEFAULT 'mensual' CHECK (cycle IN ('mensual', 'anual')),
  next_renewal TEXT NOT NULL,
  url          TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
