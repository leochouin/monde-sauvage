import { useState, useEffect } from 'react';
import supabase from '../utils/supabase.js';
import ChaletHoraireModal from './chaletHoraireModal.jsx';

const EtablissementModal = ({ isEtablissementOpen, onClose }) => {
    const [establishments, setEstablishments] = useState([]);
    const [selectedEstablishment, setSelectedEstablishment] = useState(null);
    const [chalets, setChalets] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadingChalets, setLoadingChalets] = useState(false);
    const [error, setError] = useState(null);
    const [chaletError, setChaletError] = useState(null);
    
    // Chalet form states
    const [isCreatingChalet, setIsCreatingChalet] = useState(false);
    const [editingChalet, setEditingChalet] = useState(null);
    const [chaletForm, setChaletForm] = useState({
        Name: '',
        Description: '',
        nb_personnes: '',
        price_per_night: '',
        latitude: '',
        longitude: '',
        Image: null
    });
    const [imageFiles, setImageFiles] = useState([]);
    const [existingImages, setExistingImages] = useState([]);
    const [uploadingImages, setUploadingImages] = useState(false);
    const [draggedImageIndex, setDraggedImageIndex] = useState(null);

    // Chalet horaire modal states
    const [isHoraireModalOpen, setIsHoraireModalOpen] = useState(false);
    const [selectedChaletForHoraire, setSelectedChaletForHoraire] = useState(null);

    // Google Calendar connection states
    const [isConnectingGoogle, setIsConnectingGoogle] = useState(false);
    const [googleConnectionError, setGoogleConnectionError] = useState(null);
    const [googleConnectionSuccess, setGoogleConnectionSuccess] = useState(false);

    // Establishment form states
    const [isCreatingEstablishment, setIsCreatingEstablishment] = useState(false);
    const [editingEstablishment, setEditingEstablishment] = useState(null);
    const [establishmentForm, setEstablishmentForm] = useState({
        name: '',
        adresse: '',
        telephone: '',
        email: ''
    });
    const [savingEstablishment, setSavingEstablishment] = useState(false);
    const [establishmentError, setEstablishmentError] = useState(null);

    useEffect(() => {
        if (isEtablissementOpen) {
            fetchEstablishment();
            
            // Check if we're returning from Google OAuth
            const urlParams = new URLSearchParams(globalThis.location.search);
            if (urlParams.get('google_connected') === 'true') {
                setGoogleConnectionSuccess(true);
                // Clean up URL without reloading
                globalThis.history.replaceState({}, globalThis.document.title, globalThis.location.pathname);
                
                // Auto-dismiss success message after 5 seconds
                setTimeout(() => {
                    setGoogleConnectionSuccess(false);
                }, 5000);
            }
        }
    }, [isEtablissementOpen]);

    useEffect(() => {
        if (selectedEstablishment) {
            // Use 'key' if it exists, otherwise fall back to 'id'
            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;
            fetchChalets(establishmentKey);
        }
    }, [selectedEstablishment]);

    const fetchEstablishment = async () => {
        try {
            setLoading(true);
            setError(null);

            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) throw userError;
            if (!user) {
                setError("Vous devez être connecté pour voir votre établissement");
                setLoading(false);
                return;
            }

            // Fetch establishment where owner_id matches user id
            // Try different possible column names and table names
            let data = null;
            let fetchError = null;

            // First try with Etablissement (capital E) and owner_id
            let response = await supabase
                .from('Etablissement')
                .select('*')
                .eq('owner_id', user.id);

            if (response.error) {
                // Try lowercase table name
                response = await supabase
                    .from('etablissement')
                    .select('*')
                    .eq('owner_id', user.id);
            }

            if (response.error) {
                // Try with ownerId (camelCase)
                response = await supabase
                    .from('Etablissement')
                    .select('*')
                    .eq('ownerId', user.id);
            }

            data = response.data;
            console.log("Fetched establishment data:", data);
            fetchError = response.error;

            if (fetchError) {
                console.error('Fetch error:', fetchError);
                throw fetchError;
            }

            if (!data || data.length === 0) {
                setError("Aucun établissement trouvé pour cet utilisateur");
            } else {
                setEstablishments(data);
                setSelectedEstablishment(data[0]); // Select the first establishment by default
            }
        } catch (err) {
            console.error('Error fetching establishment:', err);
            console.error('Error details:', err.message, err.code, err.details);
            setError(`Erreur lors du chargement de l'établissement: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoading(false);
        }
    };

    const fetchChalets = async (establishmentKey) => {
        try {
            setLoadingChalets(true);
            setChaletError(null);

            console.log("Fetching chalets for establishment key:", establishmentKey);
            console.log("Full establishment object:", selectedEstablishment);

            // First, let's see ALL chalets to debug
            const allChalets = await supabase
                .from('chalets')
                .select('*');
            console.log("ALL chalets in database:", allChalets.data);
            
            // The correct column name is 'etablishment_id' (note the typo in your database)
            let response = await supabase
                .from('chalets')
                .select(`
                    *,
                    coordinates:location
                `)
                .eq('etablishment_id', establishmentKey);

            console.log("Query attempt (chalets/etablishment_id):", response);

            // If that fails, try with correct spelling 'establishment_id'
            if (response.error) {
                response = await supabase
                    .from('chalets')
                    .select('*')
                    .eq('establishment_id', establishmentKey);
                console.log("Second attempt (chalets/establishment_id):", response);
            }

            // Try with capital C
            if (response.error) {
                response = await supabase
                    .from('Chalets')
                    .select('*')
                    .eq('etablishment_id', establishmentKey);
                console.log("Third attempt (Chalets/etablishment_id):", response);
            }

            // Try establishmentId (camelCase)
            if (response.error) {
                response = await supabase
                    .from('chalets')
                    .select('*')
                    .eq('establishmentId', establishmentKey);
                console.log("Fourth attempt (chalets/establishmentId):", response);
            }

            const { data, error: fetchError } = response;

            if (fetchError) {
                console.error('Fetch chalets error:', fetchError);
                throw fetchError;
            }

            console.log("Fetched chalets:", data);
            
            if (!data || data.length === 0) {
                console.warn(`No chalets found with etablishment_id = "${establishmentKey}"`);
                console.warn("Please verify in Supabase that:");
                console.warn("1. The 'chalets' table has rows");
                console.warn("2. The 'etablishment_id' column values match this UUID");
            }
            
            setChalets(data || []);
        } catch (err) {
            console.error('Error fetching chalets:', err);
            setChaletError(`Erreur lors du chargement des chalets: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
        }
    };

    const handleOpenCreateChalet = () => {
        setChaletForm({
            Name: '',
            Description: '',
            nb_personnes: '',
            price_per_night: '',
            latitude: '',
            longitude: '',
            Image: null
        });
        setImageFiles([]);
        setExistingImages([]);
        setEditingChalet(null);
        setIsCreatingChalet(true);
    };

    const handleOpenEditChalet = async (chalet) => {
        // Extract lat/lon from PostGIS geometry if available
        let latitude = '';
        let longitude = '';
        
        if (chalet.location) {
            // If location is already in lat/lon format (from a previous edit)
            if (typeof chalet.location === 'object' && chalet.location.coordinates) {
                longitude = chalet.location.coordinates[0];
                latitude = chalet.location.coordinates[1];
            }
        }
        
        setChaletForm({
            Name: chalet.Name || '',
            Description: chalet.Description || '',
            nb_personnes: chalet.nb_personnes || '',
            price_per_night: chalet.price_per_night || '',
            latitude: latitude,
            longitude: longitude,
            Image: chalet.Image || null
        });
        setImageFiles([]);
        
        // Fetch existing images from chalet_images table
        try {
            const { data: images, error } = await supabase
                .from('chalet_images')
                .select('*')
                .eq('chalet_id', chalet.key)
                .order('display_order', { ascending: true });
            
            if (error) {
                console.error('Error fetching chalet images:', error);
                setExistingImages([]);
            } else {
                setExistingImages(images || []);
            }
        } catch (err) {
            console.error('Error fetching chalet images:', err);
            setExistingImages([]);
        }
        
        setEditingChalet(chalet);
        setIsCreatingChalet(true);
    };

    const handleCloseForm = () => {
        setIsCreatingChalet(false);
        setEditingChalet(null);
        setChaletForm({
            Name: '',
            Description: '',
            nb_personnes: '',
            price_per_night: '',
            latitude: '',
            longitude: '',
            Image: null
        });
        setImageFiles([]);
        setExistingImages([]);
    };

    const handleOpenHoraireModal = (chalet) => {
        setSelectedChaletForHoraire(chalet);
        setIsHoraireModalOpen(true);
    };

    const handleCloseHoraireModal = () => {
        setIsHoraireModalOpen(false);
        setSelectedChaletForHoraire(null);
    };

    const handleConnectGoogleCalendar = () => {
        if (!selectedEstablishment) return;

        try {
            setIsConnectingGoogle(true);
            setGoogleConnectionError(null);

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;

            // Redirect to OAuth endpoint with establishment ID
            const oauthUrl = new URL(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/google-calendar-oauth`
            );
            oauthUrl.searchParams.set('establishmentId', establishmentKey);
            
            // Add parameter to indicate we should reopen the modal
            const redirectUrl = new URL(globalThis.location.href);
            redirectUrl.searchParams.set('openEstablishment', 'true');
            redirectUrl.searchParams.set('google_connected', 'true');
            oauthUrl.searchParams.set('redirect_to', redirectUrl.toString());

            // Redirect to Google OAuth
            globalThis.location.href = oauthUrl.toString();
        } catch (err) {
            console.error('Error connecting Google Calendar:', err);
            setGoogleConnectionError(err.message || 'Erreur lors de la connexion à Google Calendar');
            setIsConnectingGoogle(false);
        }
    };

    const handleDisconnectGoogleCalendar = async () => {
        if (!selectedEstablishment) return;

        const confirmDisconnect = globalThis.confirm(
            'Êtes-vous sûr de vouloir déconnecter Google Calendar ? Les calendriers des chalets resteront actifs mais ne pourront plus être synchronisés.'
        );

        if (!confirmDisconnect) return;

        try {
            setIsConnectingGoogle(true);
            setGoogleConnectionError(null);

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;

            // Update the establishment to remove google_calendar_id
            const { error: updateError } = await supabase
                .from('Etablissement')
                .update({ google_calendar_id: null })
                .eq('key', establishmentKey);

            if (updateError) {
                // Try lowercase table name
                const { error: updateError2 } = await supabase
                    .from('etablissement')
                    .update({ google_calendar_id: null })
                    .eq('key', establishmentKey);
                
                if (updateError2) throw updateError2;
            }

            // Refresh the establishment data
            await fetchEstablishment();
        } catch (err) {
            console.error('Error disconnecting Google Calendar:', err);
            setGoogleConnectionError(err.message || 'Erreur lors de la déconnexion');
        } finally {
            setIsConnectingGoogle(false);
        }
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        setChaletForm(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleImageChange = (e) => {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            setImageFiles(prev => [...prev, ...files]);
        }
    };

    const handleRemoveNewImage = (index) => {
        setImageFiles(prev => prev.filter((_, i) => i !== index));
    };

    const handleRemoveExistingImage = async (imageId) => {
        try {
            const { error } = await supabase
                .from('chalet_images')
                .delete()
                .eq('id', imageId);
            
            if (error) throw error;
            
            setExistingImages(prev => prev.filter(img => img.id !== imageId));
        } catch (error) {
            console.error('Error removing image:', error);
            alert('Erreur lors de la suppression de l\'image');
        }
    };

    const handleDragStart = (index, isExisting) => {
        setDraggedImageIndex({ index, isExisting });
    };

    const handleDragOver = (e) => {
        e.preventDefault();
    };

    const handleDrop = (targetIndex, isTargetExisting) => {
        if (!draggedImageIndex) return;
        
        const { index: sourceIndex, isExisting: isSourceExisting } = draggedImageIndex;
        
        // Only allow reordering within the same category (existing or new)
        if (isSourceExisting !== isTargetExisting) {
            setDraggedImageIndex(null);
            return;
        }
        
        if (isSourceExisting) {
            const newOrder = [...existingImages];
            const [removed] = newOrder.splice(sourceIndex, 1);
            newOrder.splice(targetIndex, 0, removed);
            setExistingImages(newOrder);
        } else {
            const newOrder = [...imageFiles];
            const [removed] = newOrder.splice(sourceIndex, 1);
            newOrder.splice(targetIndex, 0, removed);
            setImageFiles(newOrder);
        }
        
        setDraggedImageIndex(null);
    };

    const uploadImage = async (file) => {
        try {
            const fileExt = file.name.split('.').pop();
            const fileName = `${Math.random().toString(36).substring(2)}-${Date.now()}.${fileExt}`;
            const filePath = `images/${fileName}`;

            const { error: uploadError } = await supabase.storage
                .from('chalets')
                .upload(filePath, file);

            if (uploadError) {
                throw uploadError;
            }

            const { data: { publicUrl } } = supabase.storage
                .from('chalets')
                .getPublicUrl(filePath);

            return publicUrl;
        } catch (error) {
            console.error('Error uploading image:', error);
            throw error;
        }
    };

    const uploadMultipleImages = async (files) => {
        setUploadingImages(true);
        try {
            const uploadPromises = files.map(file => uploadImage(file));
            const urls = await Promise.all(uploadPromises);
            return urls;
        } catch (error) {
            console.error('Error uploading images:', error);
            throw error;
        } finally {
            setUploadingImages(false);
        }
    };

    const handleSubmitChalet = async (e) => {
        e.preventDefault();
        
        try {
            setLoadingChalets(true);
            setChaletError(null);

            // Upload new images if there are any
            let newImageUrls = [];
            if (imageFiles.length > 0) {
                newImageUrls = await uploadMultipleImages(imageFiles);
            }

            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;
            
            // Keep the first existing or new image as the main Image field (for backward compatibility)
            let mainImageUrl = chaletForm.Image;
            if (existingImages.length > 0) {
                mainImageUrl = existingImages[0].image_url;
            } else if (newImageUrls.length > 0) {
                mainImageUrl = newImageUrls[0];
            }
            
            const chaletData = {
                Name: chaletForm.Name,
                Description: chaletForm.Description,
                nb_personnes: chaletForm.nb_personnes ? parseInt(chaletForm.nb_personnes) : null,
                price_per_night: chaletForm.price_per_night ? parseFloat(chaletForm.price_per_night) : null,
                etablishment_id: establishmentKey,
                Image: mainImageUrl
            };

            // Add location if both latitude and longitude are provided
            if (chaletForm.latitude && chaletForm.longitude) {
                const lat = parseFloat(chaletForm.latitude);
                const lon = parseFloat(chaletForm.longitude);
                
                if (!isNaN(lat) && !isNaN(lon)) {
                    // Create a GeoJSON Point object that PostGIS can understand
                    // Format: POINT(longitude latitude)
                    chaletData.location = `POINT(${lon} ${lat})`;
                }
            }

            let chaletKey;
            if (editingChalet) {
                // Update existing chalet
                const { error: updateError } = await supabase
                    .from('chalets')
                    .update(chaletData)
                    .eq('key', editingChalet.key);

                if (updateError) throw updateError;
                chaletKey = editingChalet.key;
                
                // Update display order for existing images
                for (let i = 0; i < existingImages.length; i++) {
                    const { error: orderError } = await supabase
                        .from('chalet_images')
                        .update({ display_order: i })
                        .eq('id', existingImages[i].id);
                    
                    if (orderError) console.error('Error updating image order:', orderError);
                }
            } else {
                // Create new chalet
                const { data: newChalet, error: insertError } = await supabase
                    .from('chalets')
                    .insert([chaletData])
                    .select();

                if (insertError) throw insertError;
                chaletKey = newChalet[0].key;
            }
            
            // Insert new images into chalet_images table
            if (newImageUrls.length > 0) {
                const startOrder = existingImages.length;
                const imageRecords = newImageUrls.map((url, index) => ({
                    chalet_id: chaletKey,
                    image_url: url,
                    display_order: startOrder + index
                }));
                
                const { error: imageError } = await supabase
                    .from('chalet_images')
                    .insert(imageRecords);
                
                if (imageError) {
                    console.error('Error inserting images:', imageError);
                }
            }

            // Refresh the chalets list
            await fetchChalets(establishmentKey);
            handleCloseForm();
        } catch (err) {
            console.error('Error saving chalet:', err);
            setChaletError(`Erreur lors de la sauvegarde: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
        }
    };

    const handleDeleteChalet = async (chaletKey) => {
        if (!globalThis.confirm('Êtes-vous sûr de vouloir supprimer ce chalet?')) {
            return;
        }

        try {
            setLoadingChalets(true);
            setChaletError(null);

            const { error: deleteError } = await supabase
                .from('chalets')
                .delete()
                .eq('key', chaletKey);

            if (deleteError) throw deleteError;

            // Refresh the chalets list
            const establishmentKey = selectedEstablishment.key || selectedEstablishment.id;
            await fetchChalets(establishmentKey);
        } catch (err) {
            console.error('Error deleting chalet:', err);
            setChaletError(`Erreur lors de la suppression: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setLoadingChalets(false);
        }
    };

    const handleOpenCreateEstablishment = () => {
        setEstablishmentForm({
            name: '',
            adresse: '',
            telephone: '',
            email: ''
        });
        setEstablishmentError(null);
        setEditingEstablishment(null);
        setIsCreatingEstablishment(true);
    };

    const handleOpenEditEstablishment = (establishment) => {
        setEstablishmentForm({
            name: establishment.Name || establishment.name || '',
            adresse: establishment.Description || establishment.adresse || '',
            telephone: establishment.telephone || '',
            email: establishment.email || ''
        });
        setEstablishmentError(null);
        setEditingEstablishment(establishment);
        setIsCreatingEstablishment(true);
    };

    const handleCloseEstablishmentForm = () => {
        setIsCreatingEstablishment(false);
        setEditingEstablishment(null);
        setEstablishmentForm({
            name: '',
            adresse: '',
            telephone: '',
            email: ''
        });
        setEstablishmentError(null);
    };

    const handleEstablishmentFormChange = (e) => {
        const { name, value } = e.target;
        setEstablishmentForm(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmitEstablishment = async (e) => {
        e.preventDefault();
        
        try {
            setSavingEstablishment(true);
            setEstablishmentError(null);

            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();
            
            if (userError) throw userError;
            if (!user) throw new Error('Vous devez être connecté');

            if (editingEstablishment) {
                // Update existing establishment
                const { error: updateError } = await supabase
                    .from('Etablissement')
                    .update({
                        Name: establishmentForm.name,
                        Description: establishmentForm.adresse || '',
                        telephone: establishmentForm.telephone || null,
                        email: establishmentForm.email || null
                    })
                    .eq('key', editingEstablishment.key || editingEstablishment.id);

                if (updateError) throw updateError;

                // Close form and refresh list
                handleCloseEstablishmentForm();
                await fetchEstablishment();
            } else {
                // Create new establishment
                const { data, error: insertError } = await supabase
                    .from('Etablissement')
                    .insert([
                        {
                            Name: establishmentForm.name,
                            Description: establishmentForm.adresse || '',
                            telephone: establishmentForm.telephone || null,
                            email: establishmentForm.email || null,
                            owner_id: user.id
                        }
                    ])
                    .select();

                if (insertError) throw insertError;

                // Close form and refresh list
                handleCloseEstablishmentForm();
                await fetchEstablishment();

                // Auto-select the new establishment
                if (data && data.length > 0) {
                    setSelectedEstablishment(data[0]);
                }
            }
        } catch (err) {
            console.error('Error saving establishment:', err);
            setEstablishmentError(`Erreur lors de ${editingEstablishment ? 'la modification' : 'la création'}: ${err.message || 'Erreur inconnue'}`);
        } finally {
            setSavingEstablishment(false);
        }
    };

    const handleDeleteEstablishment = async (establishmentKey) => {
        const establishment = establishments.find(est => 
            (est.key || est.id) === establishmentKey
        );
        
        const confirmMessage = `Êtes-vous sûr de vouloir supprimer "${establishment?.Name || establishment?.name || 'cet établissement'}" ?\n\nCette action supprimera également tous les chalets associés et ne peut pas être annulée.`;
        
        if (!globalThis.confirm(confirmMessage)) {
            return;
        }

        try {
            setLoading(true);
            setError(null);

            // Delete the establishment (cascade should handle chalets)
            const { error: deleteError } = await supabase
                .from('Etablissement')
                .delete()
                .eq('key', establishmentKey);

            if (deleteError) throw deleteError;

            // Refresh establishments list
            await fetchEstablishment();

            // If we deleted the currently selected establishment, clear selection
            if (selectedEstablishment && (selectedEstablishment.key || selectedEstablishment.id) === establishmentKey) {
                setSelectedEstablishment(null);
                setChalets([]);
            }
        } catch (err) {
            console.error('Error deleting establishment:', err);
            setError(`Erreur lors de la suppression: ${err.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (!isEtablissementOpen) return null;

    return (
        <div className="guide-profile-fullscreen">
            {/* Header */}
            <div className="guide-profile-header">
                <div style={{ display: "flex", alignItems: "center", gap: 16, justifyContent: "space-between", width: "100%" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                        <button type="button" className="guide-back-button" onClick={onClose}>
                            ← Retour
                        </button>
                        <div>
                            <h1 className="guide-profile-title" style={{ marginBottom: '4px' }}>Mes Établissements</h1>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', margin: 0 }}>Gérez vos lieux de réservation</p>
                        </div>
                    </div>
                    {!loading && !error && (
                        <button
                            type="button"
                            onClick={handleOpenCreateEstablishment}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '0.95rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}
                        >
                            <span style={{ fontSize: '1.2rem' }}>+</span>
                            <span>Ajouter un lieu</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div className="guide-profile-content">
                {/* Loading State */}
                {loading && (
                    <div style={{ textAlign: 'center', padding: '60px', color: '#64748b' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px' }}>⏳</div>
                        <p style={{ fontSize: '1.1rem' }}>Chargement de vos établissements...</p>
                    </div>
                )}

                {/* Error State */}
                {error && !loading && (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '16px' }}>⚠️</div>
                        <p style={{ color: '#ef4444', marginBottom: '20px', fontSize: '1.05rem' }}>{error}</p>
                        <button 
                            type="button"
                            onClick={fetchEstablishment}
                            style={{
                                padding: '12px 24px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '1rem',
                                fontWeight: '600'
                            }}
                        >
                            Réessayer
                        </button>
                    </div>
                )}

                {/* No establishments state */}
                {!loading && !error && establishments.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <div style={{ fontSize: '3rem', marginBottom: '20px' }}>🏕️</div>
                        <h2 style={{ fontSize: '1.5rem', color: '#334155', marginBottom: '12px' }}>Aucun établissement encore</h2>
                        <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '1.05rem' }}>
                            Commencez par ajouter votre premier lieu de réservation
                        </p>
                        <button
                            type="button"
                            onClick={handleOpenCreateEstablishment}
                            style={{
                                padding: '14px 28px',
                                backgroundColor: '#059669',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '600',
                                fontSize: '1.05rem',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '10px'
                            }}
                        >
                            <span style={{ fontSize: '1.3rem' }}>+</span>
                            <span>Ajouter mon premier lieu</span>
                        </button>
                    </div>
                )}

                {/* Display Establishments List */}
                {!loading && !error && establishments.length > 0 && !selectedEstablishment && (
                    <div style={{ padding: '20px' }}>
                        <h2 style={{ fontSize: '1.3rem', color: '#334155', marginBottom: '8px' }}>Vos lieux de réservation</h2>
                        <p style={{ color: '#64748b', marginBottom: '24px' }}>Sélectionnez un établissement pour le gérer</p>
                        
                        <div style={{ display: 'grid', gap: '16px' }}>
                            {establishments.map((est) => (
                                <div
                                    key={est.id}
                                    style={{
                                        padding: '20px',
                                        backgroundColor: 'white',
                                        borderRadius: '10px',
                                        border: '2px solid #e2e8f0',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                        position: 'relative'
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = '#059669';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(5, 150, 105, 0.15)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = '#e2e8f0';
                                        e.currentTarget.style.boxShadow = 'none';
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                        <div 
                                            style={{ flex: 1 }}
                                            onClick={() => setSelectedEstablishment(est)}
                                        >
                                            <h3 style={{ fontSize: '1.2rem', color: '#059669', marginBottom: '12px', fontWeight: '600' }}>
                                                {est.Name || est.name || `Établissement ${est.key || est.id}`}
                                            </h3>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {(est.Description || est.adresse) && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>📍</span>
                                                        <span>{est.Description || est.adresse}</span>
                                                    </div>
                                                )}
                                                {est.telephone && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>📞</span>
                                                        <span>{est.telephone}</span>
                                                    </div>
                                                )}
                                                {est.email && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#64748b' }}>
                                                        <span>✉️</span>
                                                        <span>{est.email}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteEstablishment(est.key || est.id);
                                            }}
                                            style={{
                                                padding: '8px 16px',
                                                backgroundColor: '#fee2e2',
                                                color: '#dc2626',
                                                border: '1px solid #fecaca',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.9rem',
                                                fontWeight: '500',
                                                transition: 'all 0.2s'
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#dc2626';
                                                e.currentTarget.style.color = 'white';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '#fee2e2';
                                                e.currentTarget.style.color = '#dc2626';
                                            }}
                                        >
                                            Supprimer
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Display Selected Establishment Data */}
                {!loading && !error && selectedEstablishment && (
                    <>
                        {/* Back to list button */}
                        <div style={{ padding: '20px', paddingBottom: '0' }}>
                            <button
                                type="button"
                                onClick={() => setSelectedEstablishment(null)}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: '#f1f5f9',
                                    color: '#475569',
                                    border: '1px solid #cbd5e1',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: '500',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <span>←</span>
                                <span>Retour à la liste</span>
                            </button>
                        </div>

                        {/* Left Column - Establishment Information */}
                        <div className="guide-profile-left">
                            {/* Establishment Info */}
                            <div className="guide-section guide-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '8px', flexWrap: 'wrap' }}>
                                    <h2 className="guide-section-title" style={{ marginBottom: 0 }}>📋 Informations du lieu</h2>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button
                                            type="button"
                                            onClick={() => handleOpenEditEstablishment(selectedEstablishment)}
                                            style={{
                                                padding: '6px 14px',
                                                backgroundColor: '#dbeafe',
                                                color: '#1e40af',
                                                border: '1px solid #93c5fd',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '500'
                                            }}
                                        >
                                            ✏️ Modifier
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteEstablishment(selectedEstablishment.key || selectedEstablishment.id)}
                                            style={{
                                                padding: '6px 14px',
                                                backgroundColor: '#fee2e2',
                                                color: '#dc2626',
                                                border: '1px solid #fecaca',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '0.85rem',
                                                fontWeight: '500'
                                            }}
                                        >
                                            🗑️ Supprimer
                                        </button>
                                    </div>
                                </div>
                                <div className="guide-section-content">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                        <div>
                                            <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Nom du lieu</label>
                                            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                {selectedEstablishment.Name || selectedEstablishment.name || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                            </p>
                                        </div>
                                        
                                        <div>
                                            <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Description / Adresse</label>
                                            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                {selectedEstablishment.Description || selectedEstablishment.adresse || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                            </p>
                                        </div>
                                        
                                        <div>
                                            <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Téléphone</label>
                                            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                {selectedEstablishment.telephone || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                            </p>
                                        </div>
                                        
                                        <div>
                                            <label style={{ fontWeight: '600', color: '#334155', fontSize: '0.9rem' }}>Courriel</label>
                                            <p style={{ color: '#64748b', marginTop: '6px', fontSize: '1.05rem' }}>
                                                {selectedEstablishment.email || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Non renseigné</span>}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Google Calendar Connection */}
                            <div className="guide-section guide-card">
                                <h2 className="guide-section-title">📅 Calendrier de réservations</h2>
                                <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '16px', marginTop: '-8px' }}>
                                    Synchronisez vos réservations avec Google Calendar
                                </p>
                                <div className="guide-section-content">
                                    {googleConnectionSuccess && (
                                        <div style={{
                                            padding: '12px',
                                            backgroundColor: '#d1fae5',
                                            color: '#065f46',
                                            borderRadius: '6px',
                                            marginBottom: '16px',
                                            fontSize: '0.9rem',
                                            border: '1px solid #10b981',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px'
                                        }}>
                                            <span>✅</span>
                                            <span>Google Calendar connecté avec succès!</span>
                                        </div>
                                    )}
                                    {selectedEstablishment.google_calendar_id ? (
                                        <div>
                                            <div style={{
                                                padding: '16px',
                                                backgroundColor: '#f0fdf4',
                                                borderRadius: '8px',
                                                marginBottom: '16px',
                                                border: '1px solid #86efac'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '1.2rem' }}>✅</span>
                                                    <span style={{ color: '#059669', fontWeight: '600' }}>
                                                        Calendrier connecté
                                                    </span>
                                                </div>
                                                <p style={{ color: '#64748b', fontSize: '0.95rem', marginLeft: '28px' }}>
                                                    Vos chalets peuvent synchroniser leurs réservations automatiquement.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleDisconnectGoogleCalendar}
                                                disabled={isConnectingGoogle}
                                                style={{
                                                    padding: '10px 20px',
                                                    backgroundColor: '#ef4444',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: isConnectingGoogle ? 'not-allowed' : 'pointer',
                                                    fontWeight: '500',
                                                    fontSize: '0.9rem',
                                                    opacity: isConnectingGoogle ? 0.6 : 1
                                                }}
                                            >
                                                {isConnectingGoogle ? 'Déconnexion...' : 'Déconnecter le calendrier'}
                                            </button>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{
                                                padding: '16px',
                                                backgroundColor: '#fef3c7',
                                                borderRadius: '8px',
                                                marginBottom: '16px',
                                                border: '1px solid #fbbf24'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                                    <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                                                    <span style={{ color: '#92400e', fontWeight: '600' }}>
                                                        Calendrier non connecté
                                                    </span>
                                                </div>
                                                <p style={{ color: '#92400e', fontSize: '0.95rem', marginLeft: '28px' }}>
                                                    Connectez Google Calendar pour gérer automatiquement les réservations de vos chalets.
                                                </p>
                                            </div>
                                            
                                            {googleConnectionError && (
                                                <div style={{
                                                    padding: '12px',
                                                    backgroundColor: '#fee2e2',
                                                    color: '#991b1b',
                                                    borderRadius: '6px',
                                                    marginBottom: '16px',
                                                    fontSize: '0.9rem'
                                                }}>
                                                    {googleConnectionError}
                                                </div>
                                            )}

                                            <button
                                                type="button"
                                                onClick={handleConnectGoogleCalendar}
                                                disabled={isConnectingGoogle}
                                                style={{
                                                    padding: '10px 20px',
                                                    backgroundColor: '#3b82f6',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '6px',
                                                    cursor: isConnectingGoogle ? 'not-allowed' : 'pointer',
                                                    fontWeight: '500',
                                                    fontSize: '0.9rem',
                                                    opacity: isConnectingGoogle ? 0.6 : 1,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '8px'
                                                }}
                                            >
                                                <span>📅</span>
                                                <span>{isConnectingGoogle ? 'Connexion...' : 'Connecter mon calendrier'}</span>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Chalets Management */}
                            <div className="guide-section guide-card">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                                    <div>
                                        <h2 className="guide-section-title" style={{ marginBottom: '6px' }}>🏠 Vos chalets</h2>
                                        <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0 }}>
                                            Les unités de location disponibles pour vos clients
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={handleOpenCreateChalet}
                                        style={{
                                            padding: '10px 18px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        + Ajouter un chalet
                                    </button>
                                </div>
                                <div className="guide-section-content">
                                    {loadingChalets && (
                                        <div style={{ textAlign: 'center', padding: '20px' }}>
                                            <p style={{ color: '#64748b', fontSize: '0.95rem' }}>⏳ Chargement...</p>
                                        </div>
                                    )}

                                    {chaletError && (
                                        <div style={{ padding: '16px', backgroundColor: '#fee2e2', borderRadius: '8px', marginBottom: '12px' }}>
                                            <p style={{ color: '#dc2626', fontSize: '0.95rem', margin: 0 }}>
                                                ⚠️ {chaletError}
                                            </p>
                                        </div>
                                    )}

                                    {!loadingChalets && !chaletError && chalets.length === 0 && (
                                        <div style={{ textAlign: 'center', padding: '30px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                                            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🏠</div>
                                            <p style={{ color: '#64748b', fontSize: '1rem', marginBottom: '8px' }}>
                                                Aucun chalet pour le moment
                                            </p>
                                            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                                                Cliquez sur "Ajouter un chalet" pour commencer
                                            </p>
                                        </div>
                                    )}

                                    {!loadingChalets && !chaletError && chalets.length > 0 && (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {chalets.map((chalet, index) => (
                                                <div 
                                                    key={chalet.id || chalet.key || `chalet-${index}`}
                                                    style={{
                                                        padding: '16px',
                                                        backgroundColor: '#f8fafc',
                                                        borderRadius: '8px',
                                                        border: '1px solid #e2e8f0',
                                                        position: 'relative'
                                                    }}
                                                >
                                                    {chalet.Image && (
                                                        <img 
                                                            src={chalet.Image} 
                                                            alt={chalet.Name}
                                                            style={{
                                                                width: '100%',
                                                                height: '150px',
                                                                objectFit: 'cover',
                                                                borderRadius: '6px',
                                                                marginBottom: '12px'
                                                            }}
                                                        />
                                                    )}
                                                    <h3 style={{ 
                                                        fontSize: '1.1rem', 
                                                        fontWeight: 'bold', 
                                                        color: '#334155',
                                                        marginBottom: '8px'
                                                    }}>
                                                        {chalet.Name || `Chalet ${chalet.id}`}
                                                    </h3>
                                                    
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
                                                        {chalet.nb_personnes && (
                                                            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                                                                <strong>Capacité:</strong> {chalet.nb_personnes} personnes
                                                            </p>
                                                        )}
                                                        {chalet.price_per_night && (
                                                            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                                                                <strong>Prix par nuit:</strong> {chalet.price_per_night}$
                                                            </p>
                                                        )}
                                                        {chalet.Description && (
                                                            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
                                                                <strong>Description:</strong> {chalet.Description}
                                                            </p>
                                                        )}
                                                    </div>

                                                    <div style={{ display: 'flex', gap: '8px' }}>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenEditChalet(chalet)}
                                                            style={{
                                                                padding: '6px 12px',
                                                                backgroundColor: '#3b82f6',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.85rem'
                                                            }}
                                                        >
                                                            Modifier
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteChalet(chalet.key)}
                                                            style={{
                                                                padding: '6px 12px',
                                                                backgroundColor: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontSize: '0.85rem'
                                                            }}
                                                        >
                                                            Supprimer
                                                        </button>
                                                        <button
                                                        type="button"
                                                        onClick={() => handleOpenHoraireModal(chalet)}
                                                        style={{
                                                            padding: '6px 12px',
                                                            backgroundColor: '#10b981',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: 'pointer',
                                                            fontSize: '0.85rem'
                                                        }}
                                                        >Gérer l'agenda</button>
                                                    </div>
                                                </div>
                                            ))}
                                            
                                            <p style={{ 
                                                color: '#059669', 
                                                fontSize: '0.9rem', 
                                                marginTop: '8px',
                                                fontWeight: 'bold'
                                            }}>
                                                Total: {chalets.length} chalet{chalets.length > 1 ? 's' : ''}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Right Column - Additional Info */}
                        <div className="guide-profile-right">
                            <div className="guide-section guide-card">
                                <h2 className="guide-section-title">Statistiques</h2>
                                <div className="guide-section-content">
                                    <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
                                        Statistiques et aperçu de vos réservations.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Chalet Form Modal */}
            {isCreatingChalet && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        padding: '24px',
                        maxWidth: '600px',
                        width: '90%',
                        maxHeight: '90vh',
                        overflowY: 'auto'
                    }}>
                        <h2 style={{ 
                            fontSize: '1.5rem', 
                            fontWeight: 'bold', 
                            color: '#334155',
                            marginBottom: '20px'
                        }}>
                            {editingChalet ? 'Modifier le Chalet' : 'Ajouter un Nouveau Chalet'}
                        </h2>

                        <form onSubmit={handleSubmitChalet}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {/* Name */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '6px'
                                    }}>
                                        Nom du Chalet *
                                    </label>
                                    <input
                                        type="text"
                                        name="Name"
                                        value={chaletForm.Name}
                                        onChange={handleFormChange}
                                        required
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '1rem'
                                        }}
                                    />
                                </div>

                                {/* Description */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '6px'
                                    }}>
                                        Description
                                    </label>
                                    <textarea
                                        name="Description"
                                        value={chaletForm.Description}
                                        onChange={handleFormChange}
                                        rows="4"
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '1rem',
                                            resize: 'vertical'
                                        }}
                                    />
                                </div>

                                {/* Number of people */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '6px'
                                    }}>
                                        Nombre de personnes
                                    </label>
                                    <input
                                        type="number"
                                        name="nb_personnes"
                                        value={chaletForm.nb_personnes}
                                        onChange={handleFormChange}
                                        min="1"
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '1rem'
                                        }}
                                    />
                                </div>

                                {/* Price per night */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '6px'
                                    }}>
                                        Prix par nuit ($)
                                    </label>
                                    <input
                                        type="number"
                                        name="price_per_night"
                                        value={chaletForm.price_per_night}
                                        onChange={handleFormChange}
                                        min="0"
                                        step="0.01"
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '1rem'
                                        }}
                                    />
                                </div>

                                {/* Location - Latitude and Longitude */}
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                    <div>
                                        <label style={{ 
                                            display: 'block',
                                            fontWeight: '600',
                                            color: '#334155',
                                            marginBottom: '6px'
                                        }}>
                                            Latitude
                                        </label>
                                        <input
                                            type="number"
                                            name="latitude"
                                            value={chaletForm.latitude}
                                            onChange={handleFormChange}
                                            step="any"
                                            placeholder="ex: 48.4"
                                            style={{
                                                width: '100%',
                                                padding: '10px',
                                                borderRadius: '6px',
                                                border: '1px solid #cbd5e1',
                                                fontSize: '1rem'
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ 
                                            display: 'block',
                                            fontWeight: '600',
                                            color: '#334155',
                                            marginBottom: '6px'
                                        }}>
                                            Longitude
                                        </label>
                                        <input
                                            type="number"
                                            name="longitude"
                                            value={chaletForm.longitude}
                                            onChange={handleFormChange}
                                            step="any"
                                            placeholder="ex: -71.2"
                                            style={{
                                                width: '100%',
                                                padding: '10px',
                                                borderRadius: '6px',
                                                border: '1px solid #cbd5e1',
                                                fontSize: '1rem'
                                            }}
                                        />
                                    </div>
                                </div>
                                <p style={{ 
                                    fontSize: '0.85rem', 
                                    color: '#64748b',
                                    marginTop: '-8px' 
                                }}>
                                    Les coordonnées GPS permettent de localiser le chalet sur la carte
                                </p>

                                {/* Image upload */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '6px'
                                    }}>
                                        Images (Glissez-déposez pour réorganiser)
                                    </label>
                                    
                                    {/* Existing images */}
                                    {existingImages.length > 0 && (
                                        <div style={{ 
                                            display: 'grid', 
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                                            gap: '10px',
                                            marginBottom: '10px'
                                        }}>
                                            {existingImages.map((img, index) => (
                                                <div 
                                                    key={img.id}
                                                    draggable
                                                    onDragStart={() => handleDragStart(index, true)}
                                                    onDragOver={handleDragOver}
                                                    onDrop={() => handleDrop(index, true)}
                                                    style={{
                                                        position: 'relative',
                                                        cursor: 'move',
                                                        border: '2px solid #e2e8f0',
                                                        borderRadius: '8px',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <img 
                                                        src={img.image_url} 
                                                        alt={`Image ${index + 1}`}
                                                        style={{
                                                            width: '100%',
                                                            height: '120px',
                                                            objectFit: 'cover'
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveExistingImage(img.id)}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '4px',
                                                            right: '4px',
                                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '50%',
                                                            width: '24px',
                                                            height: '24px',
                                                            cursor: 'pointer',
                                                            fontSize: '14px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: '4px',
                                                        left: '4px',
                                                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                                                        color: 'white',
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        #{index + 1}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    {/* New images preview */}
                                    {imageFiles.length > 0 && (
                                        <div style={{ 
                                            display: 'grid', 
                                            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', 
                                            gap: '10px',
                                            marginBottom: '10px'
                                        }}>
                                            {imageFiles.map((file, index) => (
                                                <div 
                                                    key={index}
                                                    draggable
                                                    onDragStart={() => handleDragStart(index, false)}
                                                    onDragOver={handleDragOver}
                                                    onDrop={() => handleDrop(index, false)}
                                                    style={{
                                                        position: 'relative',
                                                        cursor: 'move',
                                                        border: '2px dashed #10b981',
                                                        borderRadius: '8px',
                                                        overflow: 'hidden'
                                                    }}
                                                >
                                                    <img 
                                                        src={URL.createObjectURL(file)} 
                                                        alt={`New ${index + 1}`}
                                                        style={{
                                                            width: '100%',
                                                            height: '120px',
                                                            objectFit: 'cover'
                                                        }}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveNewImage(index)}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '4px',
                                                            right: '4px',
                                                            backgroundColor: 'rgba(239, 68, 68, 0.9)',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '50%',
                                                            width: '24px',
                                                            height: '24px',
                                                            cursor: 'pointer',
                                                            fontSize: '14px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center'
                                                        }}
                                                    >
                                                        ×
                                                    </button>
                                                    <div style={{
                                                        position: 'absolute',
                                                        bottom: '4px',
                                                        left: '4px',
                                                        backgroundColor: 'rgba(16, 185, 129, 0.9)',
                                                        color: 'white',
                                                        padding: '2px 6px',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        Nouveau #{existingImages.length + index + 1}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    
                                    <input
                                        type="file"
                                        accept="image/*"
                                        multiple
                                        onChange={handleImageChange}
                                        style={{
                                            width: '100%',
                                            padding: '10px',
                                            borderRadius: '6px',
                                            border: '1px solid #cbd5e1',
                                            fontSize: '0.95rem'
                                        }}
                                    />
                                    <p style={{ 
                                        fontSize: '0.85rem', 
                                        color: '#64748b',
                                        marginTop: '4px' 
                                    }}>
                                        Vous pouvez sélectionner plusieurs images à la fois. La première image sera l'image principale.
                                    </p>
                                </div>

                                {/* Error message */}
                                {chaletError && (
                                    <p style={{ color: '#ef4444', fontSize: '0.9rem' }}>
                                        {chaletError}
                                    </p>
                                )}

                                {/* Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '12px', 
                                    marginTop: '8px',
                                    justifyContent: 'flex-end' 
                                }}>
                                    <button
                                        type="button"
                                        onClick={handleCloseForm}
                                        disabled={uploadingImages || loadingChalets}
                                        style={{
                                            padding: '10px 20px',
                                            backgroundColor: '#f1f5f9',
                                            color: '#334155',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: uploadingImages || loadingChalets ? 'not-allowed' : 'pointer',
                                            fontWeight: '500',
                                            opacity: uploadingImages || loadingChalets ? 0.6 : 1
                                        }}
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={uploadingImages || loadingChalets}
                                        style={{
                                            padding: '10px 20px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: uploadingImages || loadingChalets ? 'not-allowed' : 'pointer',
                                            fontWeight: '500',
                                            opacity: uploadingImages || loadingChalets ? 0.6 : 1
                                        }}
                                    >
                                        {uploadingImages ? 'Téléchargement...' : loadingChalets ? 'Enregistrement...' : 'Enregistrer'}
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Establishment Creation Modal */}
            {isCreatingEstablishment && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1000
                }}>
                    <div style={{
                        backgroundColor: 'white',
                        borderRadius: '12px',
                        padding: '32px',
                        maxWidth: '550px',
                        width: '90%',
                        maxHeight: '90vh',
                        overflowY: 'auto',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
                    }}>
                        <div style={{ marginBottom: '24px' }}>
                            <h2 style={{ 
                                fontSize: '1.6rem', 
                                fontWeight: 'bold', 
                                color: '#334155',
                                marginBottom: '8px'
                            }}>
                                🏕️ {editingEstablishment ? 'Modifier le lieu' : 'Ajouter un lieu'}
                            </h2>
                            <p style={{ color: '#64748b', fontSize: '0.95rem', margin: 0 }}>
                                {editingEstablishment 
                                    ? 'Mettez à jour les informations de votre établissement'
                                    : 'Créez un nouvel établissement pour gérer vos chalets et réservations'
                                }
                            </p>
                        </div>

                        <form onSubmit={handleSubmitEstablishment}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                                {/* Name */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Nom du lieu <span style={{ color: '#dc2626' }}>*</span>
                                    </label>
                                    <input
                                        type="text"
                                        name="name"
                                        value={establishmentForm.name}
                                        onChange={handleEstablishmentFormChange}
                                        required
                                        placeholder="Ex: Pourvoirie du Lac Bleu"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem',
                                            transition: 'border-color 0.2s'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px', margin: 0 }}>
                                        Le nom que vos clients verront
                                    </p>
                                </div>

                                {/* Address */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Description / Adresse
                                    </label>
                                    <textarea
                                        name="adresse"
                                        value={establishmentForm.adresse}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: 123 Chemin du Lac, Ville, Province"
                                        rows="3"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem',
                                            resize: 'vertical'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '6px', margin: 0 }}>
                                        Ajoutez des détails sur votre établissement
                                    </p>
                                </div>

                                {/* Telephone */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Téléphone
                                    </label>
                                    <input
                                        type="tel"
                                        name="telephone"
                                        value={establishmentForm.telephone}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: (418) 555-1234"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                </div>

                                {/* Email */}
                                <div>
                                    <label style={{ 
                                        display: 'block',
                                        fontWeight: '600',
                                        color: '#334155',
                                        marginBottom: '8px',
                                        fontSize: '0.95rem'
                                    }}>
                                        Courriel
                                    </label>
                                    <input
                                        type="email"
                                        name="email"
                                        value={establishmentForm.email}
                                        onChange={handleEstablishmentFormChange}
                                        placeholder="Ex: contact@pourvoirie.com"
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            borderRadius: '8px',
                                            border: '2px solid #e2e8f0',
                                            fontSize: '1rem'
                                        }}
                                        onFocus={(e) => e.target.style.borderColor = '#059669'}
                                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                                    />
                                </div>

                                {/* Error message */}
                                {establishmentError && (
                                    <div style={{
                                        padding: '12px',
                                        backgroundColor: '#fee2e2',
                                        color: '#dc2626',
                                        borderRadius: '8px',
                                        fontSize: '0.9rem',
                                        border: '1px solid #fecaca'
                                    }}>
                                        ⚠️ {establishmentError}
                                    </div>
                                )}

                                {/* Buttons */}
                                <div style={{ 
                                    display: 'flex', 
                                    gap: '12px', 
                                    marginTop: '8px',
                                    justifyContent: 'flex-end' 
                                }}>
                                    <button
                                        type="button"
                                        onClick={handleCloseEstablishmentForm}
                                        disabled={savingEstablishment}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#f1f5f9',
                                            color: '#475569',
                                            border: '1px solid #cbd5e1',
                                            borderRadius: '8px',
                                            cursor: savingEstablishment ? 'not-allowed' : 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            opacity: savingEstablishment ? 0.6 : 1
                                        }}
                                    >
                                        Annuler
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={savingEstablishment}
                                        style={{
                                            padding: '12px 24px',
                                            backgroundColor: '#059669',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '8px',
                                            cursor: savingEstablishment ? 'not-allowed' : 'pointer',
                                            fontWeight: '600',
                                            fontSize: '0.95rem',
                                            opacity: savingEstablishment ? 0.6 : 1
                                        }}
                                    >
                                        {savingEstablishment 
                                            ? '💾 Enregistrement...' 
                                            : editingEstablishment 
                                                ? '✅ Enregistrer les modifications' 
                                                : '✅ Créer ce lieu'
                                        }
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            
            {/* Chalet Horaire Modal */}
            <ChaletHoraireModal
                isOpen={isHoraireModalOpen}
                onClose={handleCloseHoraireModal}
                chalet={selectedChaletForHoraire}
            />
        </div>
    );
};

export default EtablissementModal;