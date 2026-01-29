# Chalet Management Features

## Overview
The establishment modal now includes full CRUD (Create, Read, Update, Delete) functionality for managing chalets associated with each establishment.

## Features Added

### 1. Create New Chalet
- Click the "**+ Ajouter un Chalet**" button in the Chalets Management section
- Fill in the form with:
  - **Nom du Chalet** (required): Name of the chalet
  - **Description**: Detailed description of the chalet
  - **Nombre de personnes**: Capacity (number of people)
  - **Prix par nuit ($)**: Price per night
  - **Latitude / Longitude**: GPS coordinates for map display
  - **Image**: Upload an image from your device

### 2. Edit Existing Chalet
- Click the "**Modifier**" button on any chalet card
- Update the fields you want to change
- Upload a new image if needed (the current image will be shown)
- Click "**Enregistrer**" to save changes

### 3. Delete Chalet
- Click the "**Supprimer**" button on any chalet card
- Confirm the deletion in the popup dialog
- The chalet will be permanently removed from the database

### 4. View Chalets
- All chalets are displayed with:
  - Chalet image (if available)
  - Name
  - Capacity (nb_personnes)
  - Price per night
  - Description
  - Edit and Delete buttons

## Database Schema

The chalets table includes the following columns:
```
- key: UUID (primary key)
- Name: Text
- Description: Text
- nb_personnes: Integer (number of people)
- price_per_night: Numeric (price per night)
- etablishment_id: UUID (foreign key to establishment)
- Image: Text (URL to image in Supabase storage)
- location: Geometry (PostGIS point data in EPSG:4326 format)
```

## Location / GPS Coordinates

The location is stored in PostGIS format as a geometry point:
- **Format**: `POINT(longitude latitude)` with SRID 4326 (WGS84)
- **Example**: `0101000020E610000000000000516250C0509071D770994840` (binary representation)
- **Input**: Simple latitude/longitude fields in the form
- **Conversion**: Automatic conversion using the `create_point_geometry()` PostgreSQL function

### How it works:
1. User enters latitude and longitude in decimal degrees (e.g., 48.4, -71.2)
2. The app calls the `create_point_geometry(lon, lat)` RPC function
3. PostGIS creates a geometry point with SRID 4326 (standard GPS format)
4. The binary geometry is stored in the `location` column

## Image Storage

Images are stored in Supabase Storage:
- **Bucket**: `chalets` (your existing bucket)
- **Path**: `images/{filename}`
- **Access**: Public read, authenticated write
- **Supported formats**: All image types (jpg, png, webp, etc.)

## Setup Instructions

### 1. Run Database Migrations

Apply the migrations to create the necessary functions:
```bash
cd monde-sauvage
supabase db push
```

This will create:
- `create_point_geometry(longitude, latitude)` - Converts lat/lon to PostGIS geometry
- `get_point_coordinates(geometry)` - Extracts lat/lon from geometry

### 2. Verify Storage Bucket

Ensure your `chalets` bucket has the correct permissions:
- Public: Yes (for read access)
- File size limit: Appropriate for images (e.g., 5MB)

## Implementation Details

### State Management
- `isCreatingChalet`: Boolean to show/hide the form modal
- `editingChalet`: Stores the chalet being edited (null for new chalets)
- `chaletForm`: Form data object with all chalet fields (including latitude/longitude)
- `imageFile`: File object for the selected image
- `uploadingImage`: Boolean loading state for image upload

### Key Functions

1. **handleOpenCreateChalet()**: Opens the form for creating a new chalet
2. **handleOpenEditChalet(chalet)**: Opens the form pre-filled with chalet data (extracts lat/lon from geometry)
3. **handleSubmitChalet(e)**: Handles form submission (create or update) with location conversion
4. **handleDeleteChalet(chaletKey)**: Deletes a chalet after confirmation
5. **uploadImage(file)**: Uploads image to Supabase storage bucket `chalets` and returns URL
6. **fetchChalets(establishmentKey)**: Refreshes the chalet list

### Form Validation
- Name field is required
- Number fields (capacity, price) have min/max constraints
- Latitude/longitude fields accept decimal numbers
- Image upload is optional
- Form is disabled during upload/save operations

## Usage Tips

1. **GPS Coordinates**: 
   - Use decimal degrees format (e.g., 48.4167, -71.0833)
   - Latitude ranges from -90 to 90
   - Longitude ranges from -180 to 180
   - For Quebec: Latitude ~45-55, Longitude ~-79 to -57
   - You can get coordinates from Google Maps by right-clicking a location

2. **Image Upload**: 
   - Images are uploaded to `chalets/images/` folder in storage
   - A loading indicator shows "Téléchargement..." during upload
   - The previous image is retained if no new image is selected

3. **Error Handling**:
   - All errors are displayed in red text below the form
   - Failed operations do not close the form, allowing retry

4. **Confirmation**:
   - Delete operations require confirmation
   - No confirmation for save operations

## Troubleshooting

### Images not uploading
- Ensure the `chalets` bucket exists in Supabase
- Check storage policies allow authenticated users to upload
- Verify the user is authenticated
- Check file size limits

### Chalets not appearing
- Check that `etablishment_id` in chalets matches the `key` field in establishments
- Verify the foreign key relationship in the database
- Look for console.log messages showing the query results

### Form not closing
- Check for JavaScript errors in the console
- Ensure all async operations complete successfully

### Location not saving
- Run the database migration to create the `create_point_geometry` function
- Verify both latitude and longitude are provided
- Check that coordinates are valid numbers
- Look for geometry errors in the console

### Location showing incorrectly
- Ensure the SRID is 4326 (WGS84) for GPS coordinates
- Verify longitude comes before latitude in POINT(lon, lat) format
- Check that the PostGIS extension is enabled in your database
