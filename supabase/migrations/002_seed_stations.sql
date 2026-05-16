INSERT INTO stations (id, name, lat, lng) VALUES
  ('shibuya',      '渋谷',   35.6580, 139.7016),
  ('daikanyama',   '代官山', 35.6488, 139.7028),
  ('nakameguro',   '中目黒', 35.6439, 139.6988),
  ('ebisu',        '恵比寿', 35.6467, 139.7101),
  ('sangenjaya',   '三軒茶屋', 35.6432, 139.6689),
  ('shimokitazawa','下北沢', 35.6613, 139.6682),
  ('ikejiri',      '池尻大橋', 35.6515, 139.6830),
  ('harajuku',     '原宿',   35.6702, 139.7027),
  ('omotesando',   '表参道', 35.6654, 139.7124),
  ('shinjuku',     '新宿',   35.6896, 139.7006)
ON CONFLICT (id) DO NOTHING;
