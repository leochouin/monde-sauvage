import { useState, useEffect } from "react";
import supabase from "../utils/supabase.js";
import ChaletDetailModal from "./chaletDetailModal.jsx";

export default function QueryModal({ isOpen, onClose, startDate, endDate, query, SelectedChalet, sRadius, nbPersonnes }) {
  const [chalets, setChalets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [startChangeDate, setStartChangeDate] = useState("");
  const [endChangeDate, setEndChangeDate] = useState("");
  const [radius, setRadius] = useState(20); // Default 20km
  const [selectChalet, setSelectChalet] = useState(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [expandedEstablishments, setExpandedEstablishments] = useState(new Set());
  
  // Initialize local state with props when modal opens
  useEffect(() => {
    if (isOpen) {
      setStartChangeDate(startDate || "");
      setEndChangeDate(endDate || "");
    }
  }, [isOpen, startDate, endDate]);

  function settingRadius(e) {
    sRadius(Number(e.target.value))
    setRadius(Number(e.target.value))
  }

  const handleVoirPlus = (chalet) => {
    setSelectChalet(chalet);
    setIsDetailModalOpen(true);
  };

  const handleCloseDetail = () => {
    setIsDetailModalOpen(false);
    setSelectChalet(null);
  };

  const toggleEstablishment = (establishmentId) => {
    setExpandedEstablishments(prev => {
      const newSet = new Set(prev);
      if (newSet.has(establishmentId)) {
        newSet.delete(establishmentId);
      } else {
        newSet.add(establishmentId);
      }
      return newSet;
    });
  };

  // Group chalets by establishment
  const chaletsByEstablishment = chalets.reduce((acc, chalet) => {
    const estId = chalet.etablishment_id || 'no-establishment';
    const estName = chalet.etablishment_name || 'Sans établissement';
    
    if (!acc[estId]) {
      acc[estId] = {
        id: estId,
        name: estName,
        chalets: []
      };
    }
    acc[estId].chalets.push(chalet);
    return acc;
  }, {});

  const establishmentGroups = Object.values(chaletsByEstablishment);

  useEffect(() => {
    if (!isOpen) return;

    const fetchChalets = async () => {
      // Prepare date parameters - convert to ISO format if dates are provided
      const startDateParam = startChangeDate ? new Date(startChangeDate).toISOString() : null;
      const endDateParam = endChangeDate ? new Date(endChangeDate).toISOString() : null;
      
      console.log("Querying Supabase with:", {
        lng: query.lngLat?.lng,
        lat: query.lngLat?.lat,
        radius_km: radius || 20,
        nb_personnes: nbPersonnes || null,
        start_date: startDateParam,
        end_date: endDateParam
      });
      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase.rpc('get_chalets_nearby', {
          lng: query.lngLat.lng,
          lat: query.lngLat.lat,
          radius_m: (radius || 20) * 1000, // Convert km to meters
          min_capacity: nbPersonnes ? Number(nbPersonnes) : null,
          check_start_date: startDateParam,
          check_end_date: endDateParam
        });
        console.log(data)

        if (error) throw error;

        // Ensure we always have an array
        setChalets(Array.isArray(data) ? data : []);
        
        // Automatically expand all establishments when chalets are loaded
        if (data && data.length > 0) {
          const uniqueEstablishmentIds = new Set(
            data.map(chalet => chalet.etablishment_id || 'no-establishment')
          );
          setExpandedEstablishments(uniqueEstablishmentIds);
        }
      } catch (err) {
        console.error("❌ Error fetching nearby chalets:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchChalets();
  }, [isOpen, query, radius, nbPersonnes, startChangeDate, endChangeDate]);
  
  // Only render modal when both open AND we have a query point from map click
  if (!isOpen || !query?.lngLat) return null;
  
  return (
    <div className="modal">
        <div className="modal-content">
            <h1 className="modal-title">Chalets</h1>
            <button className="modal-close-trip" onClick={onClose} type="button">X</button>
            <input type="date" id="startDate" value={startChangeDate} onChange={(e) => setStartChangeDate(e.target.value)}></input>
            <input type="date" id="endDate" value={endChangeDate} onChange={(e) => setEndChangeDate(e.target.value)}></input>
            
            <p className="modal-note">Rayon </p>
            <div className="slider-container">
              <input
                type="range"
                min="1" // Define the minimum value for the slider
                max="50" // Define the maximum value for the slider
                step="1" // Define the increment step
                value={radius} // Controlled component value
                onChange={(e) => settingRadius(e)} // Update state on change
                className="radius-slider"
              />
              {/* Optional: Display the current value next to the slider */}
              <p>Rayon: **{radius || 20} km**</p>
            </div>
            <h2 className="modal-subtitle">Clicker sur la carte pour choisir un hebergement.</h2>
            <h2 className="modal-subtitle">Chalets à proximité</h2>
            

            {loading && <p className="modal-loading">Chargement...</p>}
            {error && <p className="modal-error">Erreur: {error}</p>}

            <div className="chalet-list-container">
              {!loading && !error && (
              chalets.length === 0 ? (
                  <p className="modal-empty">Aucun chalet trouvé à proximité.</p>
              ) : (
                  <div className="establishments-list">
                    {establishmentGroups.map((establishment) => (
                      <div key={establishment.id} className="establishment-group">
                        <div 
                          className="establishment-header"
                          onClick={() => toggleEstablishment(establishment.id)}
                        >
                          <span className="establishment-toggle">
                            {expandedEstablishments.has(establishment.id) ? '▼' : '▶'}
                          </span>
                          <h3 className="establishment-name">{establishment.name}</h3>
                          <span className="establishment-count">
                            ({establishment.chalets.length} {establishment.chalets.length > 1 ? 'chalets' : 'chalet'})
                          </span>
                        </div>
                        
                        {expandedEstablishments.has(establishment.id) && (
                          <ul className="modal-list">
                            {establishment.chalets.map((chalet, index) => (
                              <li key={chalet.key ?? index} className="modal-list-item">
                                <strong className="chalet-name">{chalet.Name}</strong>: 
                                <span className="chalet-description">{chalet.Description}</span>
                                <img src={chalet.Image} alt={chalet.Name} className="chalet-image" />
                                <span className="chalet-people">Capacité: {chalet.nb_personnes} personnes</span>
                                
                                <div className="chalet-buttons">
                                  <button 
                                    className="chalet-select-button"
                                    onClick={() => handleVoirPlus(chalet)}
                                    type="button"
                                  >
                                    Voir plus
                                  </button>
                                  {SelectedChalet && (
                                    <button 
                                      className="chalet-select-button chalet-confirm-button"
                                      onClick={() => SelectedChalet({ id: chalet.id, name: chalet.Name, ...chalet })}
                                      type="button"
                                      style={{ backgroundColor: '#2D5F4C', color: 'white' }}
                                    >
                                      Sélectionner
                                    </button>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>
              )
              )}
            </div>
            

            
        </div>

        {/* Chalet Detail Modal */}
        <ChaletDetailModal 
          isOpen={isDetailModalOpen}
          onClose={handleCloseDetail}
          chalet={selectChalet}
        />
        
    </div>

  );
}
