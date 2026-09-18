-- A birthday whose year nobody knows.
--
-- CleanCloud captures birthdayDay/birthdayMonth at sign-up and never asks for a
-- year, which is enough to send a birthday card but not enough to fill a DATE
-- column. The imported row carries a placeholder year; this flag is what stops
-- that placeholder ever being shown or exported as if it were real.
--
-- Defaults true, so every existing recipient and every source that does supply
-- a year keeps behaving exactly as before. NOT NULL with a default rewrites no
-- rows on Postgres 11+.
ALTER TABLE "recipients"
  ADD COLUMN "birth_year_known" BOOLEAN NOT NULL DEFAULT true;
