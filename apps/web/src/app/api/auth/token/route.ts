import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export async function GET() {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ token: null }, { status: 401 });
  }

  const token = await getToken();
  if (!token) {
    return NextResponse.json({ token: null }, { status: 503 });
  }

  return NextResponse.json(
    { token },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
