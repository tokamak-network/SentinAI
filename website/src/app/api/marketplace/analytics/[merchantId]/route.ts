export async function GET(request: Request, { params }: { params: Promise<{ merchantId: string }> }) {
    return new Response(JSON.stringify({ 
        availabilityPercent: 99.9,
        responseTimeMs: 150,
        supportLevel: '24/7 Premium',
        refundPolicy: '5% credit if SLA missed'
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
