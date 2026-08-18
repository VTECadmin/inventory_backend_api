-- Seed data for the e2e test database (vtec_dashboard_test).
-- All three users have the password: password123
INSERT INTO users (email, password_hash, full_name, user_role) VALUES
  ('admin@vtec.com',    '$2b$10$8DF/L/ONqkbEjmsPj/GINOkW3ubzbRD4A8c5wcr/rhUCYjh0riLwS', 'Admin VTEC',    'admin'),
  ('manager@vtec.com',  '$2b$10$8DF/L/ONqkbEjmsPj/GINOkW3ubzbRD4A8c5wcr/rhUCYjh0riLwS', 'Manager VTEC',  'manager'),
  ('employee@vtec.com', '$2b$10$8DF/L/ONqkbEjmsPj/GINOkW3ubzbRD4A8c5wcr/rhUCYjh0riLwS', 'Employee VTEC', 'employee');

INSERT INTO categories (name) VALUES ('Electronics'), ('Optics');

INSERT INTO items (description, location_id, qty_available, qty_found) VALUES
  ('Test laser diode', (SELECT id FROM locations WHERE name = 'Lab 01'),       5, 5),
  ('Test fiber cable', (SELECT id FROM locations WHERE name = 'Storage Room'), 3, 3);
