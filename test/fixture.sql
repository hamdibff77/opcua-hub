DROP TABLE IF EXISTS public.readings;
CREATE TABLE public.readings (
    id SERIAL PRIMARY KEY,
    "Date et heure" timestamptz DEFAULT now(),
    temperature double precision,
    vitesse integer
);
INSERT INTO public.readings (temperature, vitesse) VALUES (21.5, 100), (22.7, 110);
