import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

// Blank shell exports (GOOGLE_CLIENT_ID="") shadow Next's .env.local — treat "" as unset.
const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() || undefined;

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
  pages: { signIn: "/login", error: "/error" },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        token.googleSub = profile.sub as string;
        token.email = profile.email as string;
        token.name = (profile.name as string | undefined) ?? null;
        token.picture = (profile.picture as string | undefined) ?? null;
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        googleSub: token.googleSub as string | undefined,
      };
    },
  },
});
