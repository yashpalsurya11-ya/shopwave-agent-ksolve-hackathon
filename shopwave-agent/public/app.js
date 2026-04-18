document.addEventListener('DOMContentLoaded', async () => {
    // UI Elements
    const ticketList = document.getElementById('ticketList');
    const ticketSearch = document.getElementById('ticketSearch');
    const executionLog = document.getElementById('executionLog');
    const resolveAllBtn = document.getElementById('resolveAllBtn');
    const ticketCount = document.getElementById('ticketCount');
    const countResolved = document.getElementById('countResolved');
    const countEscalated = document.getElementById('countEscalated');
    const countFailed = document.getElementById('countFailed');
    const processingIndicator = document.getElementById('processingIndicator');

    // ── DEPLOYMENT CONFIG ─────────────────────────────────────────────────────
    let API_BASE_URL = window.backendUrl || 'http://localhost:3000';
    
    // Attempt to fetch dynamic config from Vercel Serverless Function
    try {
        console.log("[Config] Attempting to fetch serverless config...");
        const configResp = await fetch('/api/config');
        if (configResp.ok) {
            const configData = await configResp.json();
            if (configData.backendUrl) {
                API_BASE_URL = configData.backendUrl;
                console.log(`[Config] Success! Using Vercel Env Var: ${API_BASE_URL}`);
            }
        } else {
            console.warn(`[Config] Serverless function returned status ${configResp.status}. Check Vercel Root Directory settings.`);
        }
    } catch (e) {
        console.log("[Config] Error fetching config, falling back to default/manual backend URL", e);
    }

    // Clean up URL (removing trailing slash if present)
    if (API_BASE_URL.endsWith('/')) {
        API_BASE_URL = API_BASE_URL.slice(0, -1);
    }

    console.log(`[Runtime] Final API Base: ${API_BASE_URL}`);

    let isProcessing = false;
    let allTickets = [];

    // Fetch initial tickets
    async function fetchTickets() {
        try {
            ticketList.innerHTML = `
                <div class="loading-state">
                    <div class="spinner"></div>
                    <span>Connecting to Backend...</span>
                </div>`;

            const response = await fetch(`${API_BASE_URL}/tickets`);
            if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
            
            const data = await response.json();
            allTickets = data.tickets || [];
            renderTickets(allTickets);
            ticketCount.textContent = data.count || allTickets.length;
        } catch (err) {
            console.error('Failed to fetch tickets:', err);
            ticketList.innerHTML = `
                <div class="error-container glass">
                    <i data-lucide="alert-triangle" class="error-icon"></i>
                    <div class="error-msg">Failed to load tickets from backend</div>
                    <div class="error-submsg">${API_BASE_URL}</div>
                    <p class="error-hint">If you are on Vercel, ensure the <b>Root Directory</b> is set to <code>shopwave-agent</code> (not <code>public</code>).</p>
                </div>`;
            lucide.createIcons();
        }
    }

    function renderTickets(tickets) {
        ticketList.innerHTML = '';
        
        tickets.forEach((ticket, index) => {
            const card = document.createElement('div');
            card.className = `ticket-card tier-${ticket.tier}`;
            // Staggered animation delay
            card.style.animationDelay = `${index * 0.05}s`;
            
            const sourceIcon = ticket.customer_email.includes('unknown') ? 'help-circle' : 'mail';
            const dateObj = new Date(ticket.created_at);
            const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            card.innerHTML = `
                <div class="t-header">
                    <div class="t-id-badge">
                        <i data-lucide="${sourceIcon}" class="t-source-icon"></i>
                        <span class="t-id">${ticket.ticket_id}</span>
                    </div>
                    <span class="t-tier-badge t${ticket.tier}">Tier ${ticket.tier}</span>
                </div>
                <div class="t-subject">${ticket.subject}</div>
                <div class="t-footer">
                    <div class="t-email">${ticket.customer_email}</div>
                    <div class="t-time">
                        <i data-lucide="clock" class="t-source-icon"></i>
                        <span>${timeStr}</span>
                    </div>
                </div>
            `;
            ticketList.appendChild(card);
        });
        lucide.createIcons();
    }

    // Search Filtering
    ticketSearch.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allTickets.filter(t => 
            t.ticket_id.toLowerCase().includes(query) ||
            t.subject.toLowerCase().includes(query) ||
            t.customer_email.toLowerCase().includes(query)
        );
        renderTickets(filtered);
    });

    // Resolve All Tickets
    resolveAllBtn.addEventListener('click', async () => {
        if (isProcessing) return;
        
        isProcessing = true;
        resolveAllBtn.disabled = true;
        processingIndicator.style.display = 'flex';
        executionLog.innerHTML = ''; // Clear logs
        
        try {
            const response = await fetch(`${API_BASE_URL}/resolve/all`, {
                method: 'POST'
            });
            const summary = await response.json();
            
            // Simulation of "live" processing for better UX
            await processResultsLive(summary.results);
            
            // Final update of stats (though we update them during simulation too)
            countResolved.textContent = summary.resolved;
            countEscalated.textContent = summary.escalated;
            countFailed.textContent = summary.failed;

        } catch (err) {
            console.error('Resolution failed:', err);
            appendSystemError('Batch processing failed. Check server connection.');
        } finally {
            isProcessing = false;
            resolveAllBtn.disabled = false;
            processingIndicator.style.display = 'none';
        }
    });

    async function processResultsLive(results) {
        let resCount = 0;
        let escCount = 0;
        let failCount = 0;

        for (const result of results) {
            // Artificial delay to make it feel like real-time agent work
            await new Promise(resolve => setTimeout(resolve, 800));
            
            appendLogEntry(result);
            
            // Update stats live
            if (result.status === 'resolved') resCount++;
            else if (result.status === 'escalated') escCount++;
            else failCount++;

            countResolved.textContent = resCount;
            countEscalated.textContent = escCount;
            countFailed.textContent = failCount;

            // Smoother scroll to bottom
            executionLog.scrollTo({
                top: executionLog.scrollHeight,
                behavior: 'smooth'
            });
        }
    }

    function appendLogEntry(result) {
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        // Clean up reasoning trace (detect raw JSON errors)
        const displayReasoning = formatTraceText(result.reasoning_trace || 'Processing ticket logic...');

        const toolCallsHtml = result.toolCallLog ? result.toolCallLog.map(call => `
            <div class="tool-pill">
                <div class="tool-left">
                    <i data-lucide="${getToolIcon(call.tool)}" class="tool-icon"></i>
                    <span class="tool-name">${call.tool}(${JSON.stringify(call.input)})</span>
                </div>
                <div class="tool-meta">
                    ${call.retry_count > 0 ? `<span class="tool-retry">↺ ${call.retry_count} Retries</span>` : ''}
                    <span>${call.duration_ms}ms</span>
                </div>
            </div>
        `).join('') : '';

        entry.innerHTML = `
            <div class="log-title-row">
                <div class="log-ticket-info">
                    <h3>${result.ticket_id}</h3>
                    <p>Status: ${result.status}</p>
                </div>
                <span class="status-tag ${result.status}">${result.status}</span>
            </div>

            <div class="thought-bubble">
                <span class="section-label">Agent Reasoning</span>
                <p class="thought-text">${displayReasoning}</p>
            </div>

            ${toolCallsHtml ? `
                <div class="tool-calls-container">
                    <span class="section-label">Tool Interaction Trace</span>
                    ${toolCallsHtml}
                </div>
            ` : ''}

            <div class="final-response">
                <span class="section-label">Final Resolution</span>
                <p>${result.finalAnswer || 'Ticket processed.'}</p>
            </div>
        `;
        
        executionLog.appendChild(entry);
        lucide.createIcons(); // Re-initialize icons for new elements
    }

    function formatTraceText(text) {
        if (!text) return '';
        
        // Try to detect common large JSON patterns (like Gemini API errors)
        if (text.includes('Too Many Requests') || text.includes('quota')) {
            // It's likely a rate limit error. Let's make it cleaner.
            if (text.includes('Error fetching from')) {
                const parts = text.split('Error fetching from');
                return `<span class="error-highlight">Rate Limit Encountered:</span> ${parts[0].trim() || 'API Quota Exceeded'}. <br><br> <small>${text.substring(0, 200)}...</small>`;
            }
        }
        
        return text;
    }

    function getToolIcon(tool) {
        const icons = {
            'getOrder': 'box',
            'checkRefundEligibility': 'shield-check',
            'getCustomer': 'user',
            'getProduct': 'shopping-bag',
            'searchKnowledgeBase': 'search',
            'issueRefund': 'dollar-sign',
            'sendReply': 'mail',
            'escalate': 'user-plus'
        };
        return icons[tool] || 'wrench';
    }

    function appendSystemError(msg) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message glass';
        errorDiv.style.color = 'var(--danger)';
        errorDiv.style.padding = '1rem';
        errorDiv.textContent = msg;
        executionLog.appendChild(errorDiv);
    }

    // Initial Load
    fetchTickets();
});
