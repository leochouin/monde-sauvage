async function insertChaletsToSupabase(features) {
  if (!features?.length) {
    console.warn('⚠️ No features found to insert.');
    return;
  }

  const formatted = features.map((f) => {
    const coords = f.geometry.coordinates;
    const props = f.properties || {};

    return {
      Name: props.name || 'Unnamed',
      Description: props.description || '',
      location: `SRID=4326;POINT(${coords[0]} ${coords[1]})`,
    };
  });

  const { data, error } = await supabase
    .from('Chalets')
    .insert(formatted)
    .select(); // 👈 ensures Supabase returns rows

  if (error) {
    console.error('❌ Error inserting chalets:', error);
    return;
  }

  console.log(`✅ Inserted ${data?.length || 0} chalets`);
}


setTimeout(async () => {
        const features = map.querySourceFeatures('businesses', {
          sourceLayer: 'Monde_sauvage', // must match your layer name in Mapbox Studio
        });

        console.log('Found', features.length, 'features in Monde_sauvage layer');

        // Send them to Supabase
        await insertChaletsToSupabase(features);
      }, 2000);