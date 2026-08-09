import { Navigate, Route, Routes } from 'react-router-dom';

import { RequireAuth } from '@/features/auth/components/require-auth.tsx';
import { ForgotPasswordPage } from '@/features/auth/pages/forgot-password.page.tsx';
import { LoginPage } from '@/features/auth/pages/login.page.tsx';
import { ResetPasswordPage } from '@/features/auth/pages/reset-password.page.tsx';
import { SignupPage } from '@/features/auth/pages/signup.page.tsx';
import { VerifyEmailPage } from '@/features/auth/pages/verify-email.page.tsx';
import { BillingPage } from '@/features/billing/pages/billing.page.tsx';
import { CheckoutCancelPage } from '@/features/billing/pages/checkout-cancel.page.tsx';
import { CheckoutSuccessPage } from '@/features/billing/pages/checkout-success.page.tsx';
import { KeysPage } from '@/features/keys/pages/keys.page.tsx';

export function Router() {
	return (
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

			<Route
				path="/keys"
				element={
					<RequireAuth>
						<KeysPage />
					</RequireAuth>
				}
			/>

			<Route
				path="/billing/success"
				element={
					<RequireAuth>
						<CheckoutSuccessPage />
					</RequireAuth>
				}
			/>
			<Route
				path="/billing/cancel"
				element={
					<RequireAuth>
						<CheckoutCancelPage />
					</RequireAuth>
				}
			/>

			<Route path="/billing/*" element={<Navigate to="/" replace />} />
			<Route path="*" element={<Navigate to="/" replace />} />
		</Routes>
	);
}
