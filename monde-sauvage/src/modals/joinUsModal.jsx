import React, { useState } from "react";
import { toast } from "../utils/toast.js";

export default function JoinUsModal({ isRejoindreOpen, onClose }) {
    const [role, setRole] = useState(null); // "guide" or "entreprise"
    const [submitting, setSubmitting] = useState(false);

    const [guide, setGuide] = useState({
        fullName: "",
        email: "",
        phone: "",
        languages: "",
        experienceYears: "",
        message: "",
        cv: null,
    });

    const [entreprise, setEntreprise] = useState({
        companyName: "",
        contactPerson: "",
        email: "",
        phone: "",
        website: "",
        employees: "",
        message: "",
        brochure: null,
    });

    function openForm(asRole) {
        setRole(asRole);
    }

    function closeForm() {
        setRole(null);
        setSubmitting(false);
    }

    function handleChange(e, targetState, setTargetState) {
        const { name, value, files, type } = e.target;
        if (type === "file") {
            setTargetState({ ...targetState, [name]: files[0] });
        } else {
            setTargetState({ ...targetState, [name]: value });
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitting(true);

        // Simple validation example
        if (role === "guide") {
            if (!guide.fullName || !guide.email) {
                toast.error("Veuillez renseigner votre nom et votre courriel.");
                setSubmitting(false);
                return;
            }
            // Replace with real API call
            console.log("Submitting Guide application:", guide);
        } else if (role === "entreprise") {
            if (!entreprise.companyName || !entreprise.email) {
                toast.error("Veuillez renseigner le nom de l'entreprise et le courriel.");
                setSubmitting(false);
                return;
            }
            console.log("Submitting Entreprise application:", entreprise);
        }

        // Simulate network latency
        await new Promise((r) => setTimeout(r, 800));
        toast.success("Candidature envoyée. Merci !");
        closeForm();
    }

    if (!isRejoindreOpen) return null;

    return (
        <div className="modal">
            <div className="modal-content" style={{ background: 'linear-gradient(165deg, #f8f4ea 0%, #f4efe3 48%, #f2ede2 100%)', color: '#1F3A2E' }}>
                <h1 className="modal-title" style={{ color: '#173428', fontSize: '26px', fontFamily: '"Iowan Old Style", "Palatino Linotype", serif' }}>Rejoignez-nous!</h1>
                <button type="button" className="modal-close-trip" onClick={onClose}>X</button>

                {!role ? (
                    <>
                        <h2 className="modal-subtitle">
                            Faites partie de notre équipe. Postulez comme guide ou inscrivez votre entreprise.
                        </h2>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                            <button
                                type="button"
                                onClick={() => openForm("guide")}
                                style={{
                                  width: "100%",
                                  padding: "14px 15px",
                                  border: 'none',
                                  borderRadius: '14px',
                                  background: 'linear-gradient(145deg, #214537, #2F5C49)',
                                  color: '#FFFCF7',
                                  cursor: 'pointer',
                                  fontWeight: '600',
                                  fontSize: '15px',
                                  letterSpacing: '0.02em',
                                  textAlign: 'left',
                                  boxShadow: '0 10px 20px rgba(22, 43, 34, 0.24)',
                                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                                }}
                                onMouseOver={(e) => {
                                  e.currentTarget.style.transform = 'translateY(-1px)';
                                  e.currentTarget.style.boxShadow = '0 14px 24px rgba(22, 43, 34, 0.3)';
                                }}
                                onMouseOut={(e) => {
                                  e.currentTarget.style.transform = 'translateY(0)';
                                  e.currentTarget.style.boxShadow = '0 10px 20px rgba(22, 43, 34, 0.24)';
                                }}
                            >
                                Je suis un Guide
                            </button>
                            <button
                                type="button"
                                onClick={() => openForm("entreprise")}
                                style={{
                                  width: "100%",
                                  padding: "14px 15px",
                                  border: 'none',
                                  borderRadius: '14px',
                                  background: 'linear-gradient(145deg, #214537, #2F5C49)',
                                  color: '#FFFCF7',
                                  cursor: 'pointer',
                                  fontWeight: '600',
                                  fontSize: '15px',
                                  letterSpacing: '0.02em',
                                  textAlign: 'left',
                                  boxShadow: '0 10px 20px rgba(22, 43, 34, 0.24)',
                                  transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                                }}
                                onMouseOver={(e) => {
                                  e.currentTarget.style.transform = 'translateY(-1px)';
                                  e.currentTarget.style.boxShadow = '0 14px 24px rgba(22, 43, 34, 0.3)';
                                }}
                                onMouseOut={(e) => {
                                  e.currentTarget.style.transform = 'translateY(0)';
                                  e.currentTarget.style.boxShadow = '0 10px 20px rgba(22, 43, 34, 0.24)';
                                }}
                            >
                                Je suis une Entreprise
                            </button>
                        </div>

                        <p className="modal-note" style={{ marginTop: 20, fontSize: "0.9rem", color: "#64748b" }}>
                            Candidature rapide | Nous répondons en 3-5 jours
                        </p>
                    </>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={closeForm}
                            style={{
                                background: "transparent",
                                border: "none",
                                color: "#0a7a4a",
                                cursor: "pointer",
                                fontSize: "0.9rem",
                                marginBottom: 8,
                                padding: 0,
                                textAlign: "left"
                            }}
                        >
                            ← Retour
                        </button>

                        <h2 className="modal-subtitle">
                            {role === "guide" ? "Candidature Guide" : "Candidature Entreprise"}
                        </h2>
                        <p style={{ color: "#64748b", fontSize: "0.9rem", marginBottom: 12 }}>
                            Remplissez le formulaire ci-dessous.
                        </p>

                        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                            {role === "guide" ? (
                                <>
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="fullName"
                                        value={guide.fullName}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Nom complet *"
                                        required
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="email"
                                        value={guide.email}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Email *"
                                        type="email"
                                        required
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="phone"
                                        value={guide.phone}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Téléphone"
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="languages"
                                        value={guide.languages}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Langues (séparées par des virgules)"
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="experienceYears"
                                        value={guide.experienceYears}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Années d'expérience"
                                        type="number"
                                        min="0"
                                    />
                                    <div>
                                        <label style={{ fontSize: "0.9rem", color: "#475569", marginBottom: 4, display: "block" }}>
                                            CV (PDF, DOC, DOCX)
                                        </label>
                                        <input
                                            style={{ padding: "8px", borderRadius: 6, border: "1px solid #ccc", width: "100%" }}
                                            name="cv"
                                            onChange={(e) => handleChange(e, guide, setGuide)}
                                            type="file"
                                            accept=".pdf,.doc,.docx"
                                        />
                                    </div>
                                    <textarea
                                        style={{
                                            width: "100%",
                                            minHeight: 90,
                                            padding: 10,
                                            borderRadius: 6,
                                            border: "1px solid #ccc",
                                            resize: "vertical"
                                        }}
                                        name="message"
                                        value={guide.message}
                                        onChange={(e) => handleChange(e, guide, setGuide)}
                                        placeholder="Parlez-nous de votre expérience ou disponibilité"
                                    />
                                </>
                            ) : (
                                <>
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="companyName"
                                        value={entreprise.companyName}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Nom de l'entreprise *"
                                        required
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="contactPerson"
                                        value={entreprise.contactPerson}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Personne contact"
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="email"
                                        value={entreprise.email}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Email *"
                                        type="email"
                                        required
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="phone"
                                        value={entreprise.phone}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Téléphone"
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="website"
                                        value={entreprise.website}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Site web"
                                    />
                                    <input
                                        style={{ padding: "10px 12px", borderRadius: 6, border: "1px solid #ccc" }}
                                        name="employees"
                                        value={entreprise.employees}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Nombre d'employés"
                                        type="number"
                                        min="1"
                                    />
                                    <div>
                                        <label style={{ fontSize: "0.9rem", color: "#475569", marginBottom: 4, display: "block" }}>
                                            Brochure (PDF, DOC, DOCX)
                                        </label>
                                        <input
                                            style={{ padding: "8px", borderRadius: 6, border: "1px solid #ccc", width: "100%" }}
                                            name="brochure"
                                            onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                            type="file"
                                            accept=".pdf,.doc,.docx"
                                        />
                                    </div>
                                    <textarea
                                        style={{
                                            width: "100%",
                                            minHeight: 90,
                                            padding: 10,
                                            borderRadius: 6,
                                            border: "1px solid #ccc",
                                            resize: "vertical"
                                        }}
                                        name="message"
                                        value={entreprise.message}
                                        onChange={(e) => handleChange(e, entreprise, setEntreprise)}
                                        placeholder="Parlez-nous de votre proposition ou collaboration"
                                    />
                                </>
                            )}

                            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                <button
                                    type="submit"
                                    disabled={submitting}
                                    style={{
                                      flex: 1,
                                      padding: "14px 15px",
                                      border: 'none',
                                      borderRadius: '14px',
                                      background: 'linear-gradient(145deg, #214537, #2F5C49)',
                                      color: '#FFFCF7',
                                      cursor: submitting ? 'not-allowed' : 'pointer',
                                      fontWeight: '600',
                                      fontSize: '15px',
                                      letterSpacing: '0.02em',
                                      boxShadow: '0 10px 20px rgba(22, 43, 34, 0.24)',
                                      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                                      opacity: submitting ? 0.7 : 1
                                    }}
                                    onMouseOver={(e) => {
                                      if (!submitting) {
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                        e.currentTarget.style.boxShadow = '0 14px 24px rgba(22, 43, 34, 0.3)';
                                      }
                                    }}
                                    onMouseOut={(e) => {
                                      e.currentTarget.style.transform = 'translateY(0)';
                                      e.currentTarget.style.boxShadow = '0 10px 20px rgba(22, 43, 34, 0.24)';
                                    }}
                                >
                                    {submitting ? "Envoi..." : "Soumettre"}
                                </button>
                                <button
                                    type="button"
                                    onClick={closeForm}
                                    style={{
                                        flex: 1,
                                        padding: "14px 15px",
                                        borderRadius: '14px',
                                        border: '1px solid rgba(74, 117, 98, 0.32)',
                                        background: 'rgba(255, 252, 247, 0.72)',
                                        color: '#214337',
                                        cursor: 'pointer',
                                        fontWeight: '600',
                                        fontSize: '15px',
                                        transition: 'background-color 0.2s ease, border-color 0.2s ease'
                                    }}
                                    onMouseOver={(e) => {
                                      e.currentTarget.style.backgroundColor = 'rgba(250, 245, 234, 0.9)';
                                      e.currentTarget.style.borderColor = '#2D5F4C';
                                    }}
                                    onMouseOut={(e) => {
                                      e.currentTarget.style.backgroundColor = 'rgba(255, 252, 247, 0.72)';
                                      e.currentTarget.style.borderColor = 'rgba(74, 117, 98, 0.32)';
                                    }}
                                >
                                    Annuler
                                </button>
                            </div>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}