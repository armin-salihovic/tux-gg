declare global {
	namespace App {
		interface Locals {
			user: { id: string; name: string; username: string; image: string | null } | null;
			session: { id: string; expiresAt: Date } | null;
		}
	}
}

export {};
