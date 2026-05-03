import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not set' });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'hello@flowworks.it.com',
        to: 'jacobse.richard@gmail.com',
        subject: 'FlowWork Test Email',
        html: '<p>If you see this, Resend is working.</p>',
      }),
    });

    const data = await res.json();
    return NextResponse.json({
      status: res.status,
      resendResponse: data,
      keyPrefix: apiKey.substring(0, 8) + '...',
    });
  } catch (err: any) {
    return NextResponse.json({
      error: 'Fetch to Resend failed',
      message: err.message,
    });
  }
}