// Indstillinger for Kolind Booking.
//
// supabaseUrl og supabaseKey finder du i Supabase → Project Settings → API Keys
// (brug "Publishable key", der starter med sb_publishable_). Den nøgle er
// beregnet til at ligge i en browser: databasen er beskyttet af Row Level
// Security og funktionerne i supabase/setup.sql.
//
// Læg ALDRIG en "secret" eller "service_role"-nøgle her.

export default {
  supabaseUrl: '',
  supabaseKey: '',

  siteName: 'Kolind Booking',
  siteTagline: 'Familiens ferieboliger',
  // Administratorernes navne ("X og Y godkender …") hentes fra databasen efter
  // login, så de ikke står i det offentlige repo. Dette bruges før login.
  adminNames: 'administratorerne',
};
