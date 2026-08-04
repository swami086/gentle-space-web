import "next-auth";

declare module "next-auth" {
  interface Session {
    googleSub?: string;
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    googleSub?: string;
  }
}
