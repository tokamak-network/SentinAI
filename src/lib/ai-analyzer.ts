
// Custom AI Gateway Logic
const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || "https://api.ai.tokamak.network";
const API_KEY = process.env.GEMINI_API_KEY || "";

export interface LogAnalysisResult {
    severity: 'normal' | 'warning' | 'critical';
    summary: string;
    action_item: string;
    timestamp: string;
}


export async function analyzeLogChunk(logs: Record<string, string> | string): Promise<LogAnalysisResult> {

    // Prompt Engineering
    const systemPrompt = `
    You are a Senior Protocol Engineer for an Optimism Rollup Network.
    You have access to logs from the following core components:
    - op-geth (Execution Client)
    - op-node (Consensus Client / Driver)
    - op-batcher (Transaction Batch Submitter)
    - op-proposer (State Root Proposer)

    Your task is to analyze these logs HOLISTICALLY.
    
    Check for:
    1. **Security**: P2P GossipSub Attacks, Spam, Unauthorized Access.
    2. **Consensus**: Divergence, Unsafe Head mismatch, Derivation Stalls.
    3. **Liveness**: Batcher failures (Tx ignored), Proposer timeouts.
    4. **Performance**: Sync lag, High CPU/Mem usage signatures.

    SUGGESTED ACTION GUIDELINE:
    When suggesting commands or flags, prioritize official recommendations from https://docs.optimism.io/ (e.g., using '--syncmode snap', avoiding '--gcmode archive', or setting '--rollup.disabletxpoolgossip' for replicas).

    Return ONLY a JSON object with this exact format (no markdown code blocks):
    { 
        "severity": "normal" | "warning" | "critical", 
        "summary": "Natural language diagnosis of the current network health.", 
        "action_item": "Specific command or check for the operator." 
    }
    `;

    // Construct Multi-Component Log View
    let userContent = "";
    if (typeof logs === 'string') {
        userContent = `Log Chunk:\n"""\n${logs}\n"""`;
    } else {
        userContent = "--- NETWORK LOG SNAPSHOT ---\n";
        for (const [component, log] of Object.entries(logs)) {
            userContent += `\n[COMPONENT: ${component}]\n${log}\n----------------------------\n`;
        }
    }

    try {
        console.log(`[AI Analyzer] Sending request to ${AI_GATEWAY_URL}...`);

        const response = await fetch(`${AI_GATEWAY_URL}/v1/chat/completions`, { // Assuming OpenAI-compatible path or adjust as needed
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: "gemini-3-pro", // User specified model
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userContent }
                ],
                temperature: 0.2
            })
        });

        if (!response.ok) {
            throw new Error(`Gateway responded with ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || data.output || "{}"; // Handle varying API schemas

        // Clean up markdown if AI wraps it in ```json ... ```
        const jsonStr = content.replace(/```json/g, '').replace(/```/g, '').trim();

        // Try to parse JSON, fallback to using content as summary if not valid JSON
        try {
            const parsed = JSON.parse(jsonStr);
            return {
                ...parsed,
                timestamp: new Date().toISOString()
            };
        } catch {
            // AI returned plain text instead of JSON
            return {
                severity: "normal" as const,
                summary: content.trim(),
                action_item: "AI returned non-JSON response. Check system prompt.",
                timestamp: new Date().toISOString()
            };
        }

    } catch (error: any) {
        console.error("AI Gateway Error:", error.message);
        // Fallback or "Simulation" output if Gateway is unreachable
        return {
            severity: "critical",
            summary: `Analysis Failed: Could not reach AI Gateway at ${AI_GATEWAY_URL}. (${error.message})`,
            action_item: "Check API Gateway connectivity and API Key.",
            timestamp: new Date().toISOString()
        };
    }
}
