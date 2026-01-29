import { useState } from "react";
import supabase from '../utils/supabase.js';

export default function LoginModal({ isLoginOpen, onLoginClose }) {
    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    if (!isLoginOpen) return null;

    const toggleMode = () => {
        setIsRegister(!isRegister);
        setPassword("");
        setConfirmPassword("");
        setError(null);
    };

    const handleEmailPasswordSubmit = async () => {
        setLoading(true);
        setError(null);

        // Validate passwords match for registration
        if (isRegister && password !== confirmPassword) {
            setError("Passwords don't match");
            setLoading(false);
            return;
        }

        try {
            if (isRegister) {
                // Sign up new user
                const { data, error: signUpError } = await supabase.auth.signUp({
                    email,
                    password
                });
                
                if (signUpError) throw signUpError;

                // Optionally create user row in public.users table
                if (data.user) {
                    await supabase.from('users').upsert(
                        { id: data.user.id, email: data.user.email },
                        { onConflict: 'id' }
                    );
                }

                // Success message (some providers require email confirmation)
                alert("Account created! Check your email to confirm.");
                onLoginClose();
            } else {
                // Sign in existing user
                const { error: signInError } = await supabase.auth.signInWithPassword({
                    email,
                    password
                });
                
                if (signInError) throw signInError;

                // Redirect or close modal on success
                window.location.href = '/';
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError(null);

        try {
            const { error: googleError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: 'http://localhost:5173'}
            });
            
            if (googleError) throw googleError;
            // User will be redirected to Google, then back to your app
        } catch (err) {
            setError(err.message);
            setLoading(false);
        }
    };

    return (
        <div className="login-modal-overlay">
            <div className="login-modal-container">
                <button
                    type="button"
                    onClick={onLoginClose}
                    className="login-modal-close"
                >
                    ×
                </button>

                <div className="login-modal-content">
                    <h2 className="login-modal-title">
                        {isRegister ? "Create Account" : "Welcome Back"}
                    </h2>

                    {error && (
                        <div className="login-error">
                            {error}
                        </div>
                    )}

                    <div className="login-modal-form">
                        <div className="login-input-group">
                            <label htmlFor="email" className="login-label">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="login-input"
                                placeholder="you@example.com"
                                disabled={loading}
                            />
                        </div>

                        <div className="login-input-group">
                            <label htmlFor="password" className="login-label">
                                Password
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="login-input"
                                placeholder="••••••••"
                                disabled={loading}
                            />
                        </div>

                        {isRegister && (
                            <div className="login-input-group">
                                <label htmlFor="confirmPassword" className="login-label">
                                    Confirm Password
                                </label>
                                <input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="login-input"
                                    placeholder="••••••••"
                                    disabled={loading}
                                />
                            </div>
                        )}

                        <button 
                            type="button" 
                            className="login-submit-btn"
                            onClick={handleEmailPasswordSubmit}
                            disabled={loading}
                        >
                            {loading ? 'Loading...' : (isRegister ? "Sign Up" : "Log In")}
                        </button>
                    </div>

                    <div className="login-divider">
                        <span className="login-divider-text">Or continue with</span>
                    </div>

                    <button 
                        type="button" 
                        className="login-google-btn"
                        onClick={handleGoogleSignIn}
                        disabled={loading}
                    >
                        <svg className="google-icon" viewBox="0 0 24 24" width="20" height="20">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                            />
                        </svg>
                        Sign in with Google
                    </button>

                    <div className="login-toggle">
                        {isRegister ? "Already have an account?" : "Don't have an account?"}{" "}
                        <button
                            type="button"
                            onClick={toggleMode}
                            className="login-toggle-btn"
                            disabled={loading}
                        >
                            {isRegister ? "Log in" : "Sign up"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}