CREATE TABLE IF NOT EXISTS public.schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room TEXT NOT NULL,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  section_id UUID REFERENCES public.sections(id) ON DELETE SET NULL,
  subject_id UUID REFERENCES public.subjects(id) ON DELETE SET NULL,
  subject_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS schedules_day_idx
  ON public.schedules(day);

CREATE INDEX IF NOT EXISTS schedules_teacher_day_time_idx
  ON public.schedules(teacher_id, day, start_time, end_time);

CREATE INDEX IF NOT EXISTS schedules_section_day_time_idx
  ON public.schedules(section_id, day, start_time, end_time);

CREATE INDEX IF NOT EXISTS schedules_room_day_time_idx
  ON public.schedules(room, day, start_time, end_time);

CREATE UNIQUE INDEX IF NOT EXISTS schedules_exact_duplicate_idx
  ON public.schedules (day, start_time, end_time, room, teacher_id, section_id, subject_id, subject_name);

CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS schedules_set_updated_at ON public.schedules;
CREATE TRIGGER schedules_set_updated_at
BEFORE UPDATE ON public.schedules
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_timestamp();
