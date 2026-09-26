const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://qknpncvjzubrwpwlskzr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrbnBuY3ZqenVicndwd2xza3pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MDQ0ODMsImV4cCI6MjEwNTk4MDQ4M30.ZxRr_523nNd5hKkBgRxq-fjuC558IeyIakEKffnzOQU';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
  console.log("Testing playlist fetch...");
  const { data, error } = await supabase.from('playlist').select('*');
  if (error) {
    console.error("Error fetching playlist:", error);
  } else {
    console.log("Playlist fetched successfully. Rows:", data.length);
  }

  console.log("Testing search edge function...");
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-songs?q=beatles`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    console.log("Search successful, results:", json.data?.length);
  } catch (e) {
    console.error("Error in search:", e.message);
  }
}

test();
