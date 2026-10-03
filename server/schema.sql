-- LightNet Q20 zero-touch enrollment: additive schema (safe to re-run)
CREATE TABLE IF NOT EXISTS lightnet_routers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mac VARCHAR(17) NOT NULL,
  device_token_hash CHAR(64) NOT NULL,
  model VARCHAR(64) DEFAULT NULL,
  hostname VARCHAR(64) DEFAULT NULL,
  fw_version VARCHAR(64) DEFAULT NULL,
  fw_build VARCHAR(64) DEFAULT NULL,
  wg_public_key VARCHAR(64) DEFAULT NULL,
  owner_id INT UNSIGNED DEFAULT NULL,
  site_id INT UNSIGNED DEFAULT NULL,
  status ENUM('pending','provisioned','rejected','blocked') NOT NULL DEFAULT 'pending',
  name VARCHAR(120) DEFAULT NULL,
  wan_ip VARCHAR(45) DEFAULT NULL,
  lan_gateway VARCHAR(45) DEFAULT '192.168.2.1',
  uptime INT UNSIGNED DEFAULT NULL,
  clients INT UNSIGNED DEFAULT 0,
  satellites_json MEDIUMTEXT DEFAULT NULL,
  pending_commands TEXT DEFAULT NULL,
  notes TEXT DEFAULT NULL,
  first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TIMESTAMP NULL DEFAULT NULL,
  provisioned_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mac (mac),
  KEY idx_owner (owner_id),
  KEY idx_site (site_id),
  KEY idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lightnet_firmware_builds (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fw_build VARCHAR(64) NOT NULL,
  fw_version VARCHAR(64) DEFAULT NULL,
  sysupgrade_url VARCHAR(255) DEFAULT NULL,
  sysupgrade_sha256 CHAR(64) DEFAULT NULL,
  allowed TINYINT(1) NOT NULL DEFAULT 1,
  is_latest TINYINT(1) NOT NULL DEFAULT 0,
  notes VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_build (fw_build)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lightnet_router_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  mac VARCHAR(17) DEFAULT NULL,
  router_id INT UNSIGNED DEFAULT NULL,
  event VARCHAR(32) NOT NULL,
  detail VARCHAR(500) DEFAULT NULL,
  src_ip VARCHAR(45) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_mac (mac),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lightnet_q20_settings (
  k VARCHAR(64) NOT NULL,
  v VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- sites: nullable additions, existing MikroTik rows untouched
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='radius' AND TABLE_NAME='sites' AND COLUMN_NAME='client_kind');
SET @s = IF(@c=0, 'ALTER TABLE sites ADD COLUMN client_kind VARCHAR(20) NULL DEFAULT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
SET @c = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='radius' AND TABLE_NAME='sites' AND COLUMN_NAME='lan_gateway');
SET @s = IF(@c=0, 'ALTER TABLE sites ADD COLUMN lan_gateway VARCHAR(45) NULL DEFAULT NULL', 'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- defaults: auto-provision under house owner 13 (LIGHTNET); allowed OUIs
INSERT IGNORE INTO lightnet_q20_settings (k, v) VALUES
  ('auto_provision_owner_id', '13'),
  ('allowed_ouis', '50:33:f0'),
  ('require_known_build', '0'),
  ('wg_endpoint', '34.1.223.97'),
  ('wg_port', '51820'),
  ('buy_base', 'https://lightnet.lightnetwork.pro');
