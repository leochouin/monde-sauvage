# Quick Setup Guide - Chalet Management with Location

## What's Been Updated

✅ Changed storage bucket from `chalet-images` to `chalets` (your existing bucket)
✅ Added GPS location fields (Latitude & Longitude) to the form
✅ Automatic conversion of lat/lon to PostGIS geometry format
✅ Created database functions for location handling

## Setup Steps

### 1. Apply Database Migrations

Run this command to create the location helper functions:

```bash
cd /Users/leochouinard/Documents/mondeSauvageTest/monde-sauvage
supabase db push
```

This creates two PostgreSQL functions:
- `create_point_geometry(longitude, latitude)` - Converts coordinates to PostGIS format
- `get_point_coordinates(geometry)` - Extracts coordinates from PostGIS geometry

### 2. Test the Feature

1. Start your dev server: `npm run dev`
2. Log in as an establishment owner
3. Open the Establishment modal
4. Click "**+ Ajouter un Chalet**"
5. Fill in the form:
   - **Name**: Required
   - **Description**: Optional
   - **Nombre de personnes**: Optional
   - **Prix par nuit**: Optional
   - **Latitude**: e.g., `48.4167` (Quebec City area)
   - **Longitude**: e.g., `-71.0833` (Quebec City area)
   - **Image**: Optional - select a file
6. Click "**Enregistrer**"

## How Location Works

### Input (User-Friendly)
- User enters **Latitude**: `48.4167`
- User enters **Longitude**: `-71.0833`

### Conversion (Automatic)
The app calls the database function:
```javascript
const { data } = await supabase.rpc('create_point_geometry', {
    longitude: -71.0833,
    latitude: 48.4167
});
```

### Storage (PostGIS Format)
The database stores it as:
```
0101000020E610000000000000516250C0509071D770994840
```

This is the binary representation of `POINT(-71.0833 48.4167)` with SRID 4326 (WGS84).

## Finding GPS Coordinates

### Google Maps Method:
1. Right-click on a location
2. Click the coordinates at the top
3. They're copied to clipboard in format: `48.4167, -71.0833`
4. First number = Latitude
5. Second number = Longitude

### Common Quebec Coordinates:
- **Quebec City**: 46.8139° N, -71.2080° W
- **Montreal**: 45.5017° N, -73.5673° W
- **Tremblant**: 46.2094° N, -74.5830° W

## Files Modified

1. `/src/modals/etablissementModal.jsx`
   - Updated form to use latitude/longitude instead of raw location
   - Added GPS coordinate input fields
   - Updated storage bucket to `chalets`
   - Added RPC call to convert coordinates

2. `/supabase/migrations/create_location_helper_function.sql`
   - New database functions for location handling

3. `/CHALET_MANAGEMENT.md`
   - Updated documentation with location details

## Troubleshooting

**Location not saving?**
- Ensure you ran `supabase db push`
- Check console for RPC errors
- Verify both lat and lon are provided

**Image not uploading?**
- Verify `chalets` bucket exists in Supabase
- Check bucket permissions (public read)

**Can't find coordinates?**
- Use Google Maps right-click method
- Or use a GPS app on your phone
- Format: decimal degrees (not degrees/minutes/seconds)

## Next Steps

After testing, you can:
- Remove the old migration file `create_chalet_images_bucket.sql` (no longer needed)
- Add validation for coordinate ranges (lat: -90 to 90, lon: -180 to 180)
- Add a map picker for selecting locations visually
- Display chalet locations on your existing map component
