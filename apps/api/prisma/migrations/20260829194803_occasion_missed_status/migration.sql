-- A date that came and went with no card sent is not the same as one a person
-- chose to skip. Telling someone they skipped a birthday they never touched
-- reads as an accusation, and it hid a real failure: an occasion approved with
-- a design attached could sit "Approved" for ever, unsent, with nothing to say
-- so. See docs/adr/0178.
ALTER TYPE "OccasionStatus" ADD VALUE IF NOT EXISTS 'missed';
