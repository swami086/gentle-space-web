import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  trustHost: true,
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
