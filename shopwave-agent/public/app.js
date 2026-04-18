document.addEventListener('DOMContentLoaded', () => {
  const ticketListEl = document.getElementById('ticketList');
  const ticketCountEl = document.getElementById('ticketCount');
  const resolveAllBtn = document.getElementById('resolveAllBtn');
  const executionLogEl = document.getElementById('executionLog');
  const statsPanel = document.getElementById('statsPanel');

  let configWarningShown = false;

  // Fetch initial tickets
  async function loadTickets() {
    try {
      const res = await fetch('/tickets');
      const data = await res.json();
      
      ticketCountEl.textContent = data.count;
      ticketListEl.innerHTML = '';

      data.tickets.forEach(ticket => {
        const card = document.createElement('div');
        card.className = 'ticket-card';
        card.innerHTML = `
          <div class="ticket-header">
            <span class="ticket-id">${ticket.ticket_id}</span>
            <span class="ticket-tier">Tier ${ticket.tier}</span>
          </div>
          <div class="ticket-subject">${ticket.subject}</div>
          <div class="ticket-email">${ticket.customer_email}</div>
        `;
        ticketListEl.appendChild(card);
      });
    } catch (err) {
      ticketListEl.innerHTML = `<div class="empty-state" style="color:var(--danger)">Failed to load tickets.</div>`;
    }
  }

  loadTickets();

  // Resolve All Button
  resolveAllBtn.addEventListener('click', async () => {
    resolveAllBtn.disabled = true;
    resolveAllBtn.innerHTML = `<span class="btn-icon">⏳</span> Processing...`;
    
    executionLogEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚙️</div>
        <h3>Agent is working...</h3>
        <p>Processing 20 tickets in parallel via ReAct loop.</p>
      </div>
    `;

    try {
      const res = await fetch('/resolve/all', {
        method: 'POST'
      });
      const data = await res.json();

      renderResults(data);
    } catch (err) {
      executionLogEl.innerHTML = `<div class="empty-state" style="color:var(--danger)">Error: ${err.message}</div>`;
      resolveAllBtn.disabled = false;
      resolveAllBtn.innerHTML = `<span class="btn-icon">⚡</span> Resolve All Tickets`;
    }
  });

  function renderResults(data) {
    executionLogEl.innerHTML = '';
    statsPanel.style.display = 'block';
    
    document.getElementById('statResolved').textContent = data.resolved;
    document.getElementById('statEscalated').textContent = data.escalated;
    document.getElementById('statFailed').textContent = data.failed;

    resolveAllBtn.innerHTML = `<span class="btn-icon">✅</span> Done (${data.total_time_ms}ms)`;

    // Map through results
    data.results.forEach(result => {
      const entry = document.createElement('div');
      entry.className = 'log-entry';

      let statusBadge = '';
      if (result.status === 'resolved') statusBadge = '<span class="badge success">Resolved</span>';
      else if (result.status === 'escalated') statusBadge = '<span class="badge warning">Escalated</span>';
      else statusBadge = '<span class="badge danger">Failed</span>';

      const toolTags = result.tool_calls.map(tc => 
        `<span class="tool-tag">${tc.tool} (${tc.duration_ms}ms)</span>`
      ).join('');

      let reasonText = result.reasoning_trace || 'No trace available.';
      
      // If error mentions missing OPENAI API KEY, highlight it
      if (reasonText.includes('OPENAI_API_KEY') && !configWarningShown) {
         alert("Warning: You haven't added your OpenAI/Gemini API key in the .env file! The agent is running in fail-safe mode and auto-escalating tickets.");
         configWarningShown = true;
      }

      entry.innerHTML = `
        <div class="log-header">
          <div class="log-title">
            <h3>${result.ticket_id} — ${result.subject}</h3>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.3rem">
              Confidence: ${(result.confidence_score * 100).toFixed(0)}% | Time: ${result.processing_time_ms}ms
            </div>
          </div>
          <div>${statusBadge}</div>
        </div>
        
        <div class="log-tools">
          <h4>Tool Chain (${result.tool_calls.length} steps)</h4>
          <div class="tool-list">
            ${toolTags || '<span class="text-muted">No tools executed</span>'}
          </div>
        </div>

        <div class="log-reasoning">
          <h4>Agent Reasoning</h4>
          <div class="reasoning-text">${reasonText}</div>
        </div>

        ${result.final_reply ? `
        <div class="log-reply">
          <h4>Final Customer Reply</h4>
          <div style="margin-top:0.5rem">${result.final_reply.replace(/\n/g, '<br/>')}</div>
        </div>
        ` : ''}
      `;
      executionLogEl.appendChild(entry);
    });
  }
});
