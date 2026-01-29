import React, { useState } from "react";

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
                alert("Please fill name and email for Guide application.");
                setSubmitting(false);
                return;
            }
            // Replace with real API call
            console.log("Submitting Guide application:", guide);
        } else if (role === "entreprise") {
            if (!entreprise.companyName || !entreprise.email) {
                alert("Please fill company name and email for Entreprise application.");
                setSubmitting(false);
                return;
            }
            console.log("Submitting Entreprise application:", entreprise);
        }

        // Simulate network latency
        await new Promise((r) => setTimeout(r, 800));
        alert("Application submitted. Thank you!");
        closeForm();
    }

    if (!isRejoindreOpen) return null;

    return (
        <div className="modal">
            <div className="modal-content">
                <h1 className="modal-title">Rejoignez-nous!</h1>
                <button type="button" className="modal-close-trip" onClick={onClose}>X</button>

                {!role ? (
                    <>
                        <h2 className="modal-subtitle">
                            Faites partie de notre équipe. Postulez comme guide ou inscrivez votre entreprise.
                        </h2>
                        
                        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                            <button
                                type="button"
                                className="chalet-select-button"
                                onClick={() => openForm("guide")}
                                style={{ width: "100%", padding: "12px" }}
                            >
                                Je suis un Guide
                            </button>
                            <button
                                type="button"
                                className="chalet-select-button"
                                onClick={() => openForm("entreprise")}
                                style={{ width: "100%", padding: "12px" }}
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
                                    className="chalet-select-button"
                                    style={{ flex: 1 }}
                                >
                                    {submitting ? "Envoi..." : "Soumettre"}
                                </button>
                                <button
                                    type="button"
                                    onClick={closeForm}
                                    style={{
                                        flex: 1,
                                        padding: "10px 14px",
                                        borderRadius: 6,
                                        border: "1px solid #ccc",
                                        background: "white",
                                        cursor: "pointer",
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