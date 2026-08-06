import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { ForgotPasswordPage, ResetPasswordPage } from '../auth/password-reset.pages.tsx';
import { LoginPage } from '../auth/login.page.tsx';
import { RequireAuth } from '../auth/require-auth.tsx';
import { SignupPage } from '../auth/signup.page.tsx';
import { useBootstrapAuth } from '../auth/use-bootstrap-auth.js';
import { VerifyEmailPage } from '../auth/verify-email.page.tsx';
import { BillingPage } from '../billing/billing.page.tsx';

export function App() {
	useBootstrapAuth();

	return (
		<BrowserRouter>
			<main className="shell">
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route path="/signup" element={<SignupPage />} />
					<Route path="/forgot-password" element={<ForgotPasswordPage />} />
					<Route path="/reset-password" element={<ResetPasswordPage />} />

					{/* Reachable while unverified: it is the screen that fixes that. */}
					<Route path="/verify-email" element={<VerifyEmailPage />} />

					<Route
						path="/"
						element={
							<RequireAuth>
								<BillingPage />
							</RequireAuth>
						}
					/>

					{/* Success and cancel land back here; the webhook is what actually
					    changed the subscription, so the page just refetches. */}
					<Route path="/billing/*" element={<Navigate to="/" replace />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</main>
		</BrowserRouter>
	);
}
