-- Runs once, on first container start. The integration tests use a separate database
-- so they can truncate tables freely without touching dev data.
CREATE DATABASE notifeye_test;
