/* V2 script.js - diagnostic -> synthèse -> filtrage -> wishlist + PDF
   - full client-side, no backend required
   - uses localStorage for persistent wishlist & profile
*/
const diagForm = document.getElementById('diag-form');
const diagSubmit = document.getElementById('diag-submit');
const diagReset = document.getElementById('diag-reset');
const diagResult = document.getElementById('diag-result');

let allData = [];
let wishlist = JSON.parse(localStorage.getItem('wishlist')) || [];
let userProfile = JSON.parse(localStorage.getItem('userProfile')) || null;

// load data.json
async function loadData() {
  try {
    const res = await fetch('data.json');
    const json = await res.json();
    allData = json.sources || [];
    renderOffers(allData);
    renderWishlist();
    if(userProfile) showProfileSummary(userProfile);
  } catch (e) {
    console.error('failed to load data.json', e);
  }
}

/* ---------- DIAGNOSTIC ---------- */
diagSubmit.addEventListener('click', () => {
  const form = new FormData(diagForm);
  const profile = {
    maturite: form.get('maturite') || null,
    besoin: form.get('besoin') || null,
    nature: form.get('nature') || null,
    statut: form.get('statut') || null,
    echeance: form.get('echeance') || null,
    previous_support: form.get('previous') || 'unknown'
  };

  // basic validation: require maturite + besoin
  if(!profile.maturite || !profile.besoin) {
    alert('Choisis au moins ton stade de projet et ton besoin principal.');
    return;
  }

  userProfile = profile;
  localStorage.setItem('userProfile', JSON.stringify(userProfile));
  showProfileSummary(profile);
  // filter offers by profile
  const filtered = filterByProfile(profile);
  renderOffers(filtered);
  // smooth scroll to offers
  document.getElementById('offers').scrollIntoView({behavior:'smooth', block:'start'});
});

diagReset.addEventListener('click', () => {
  diagForm.reset();
  userProfile = null;
  localStorage.removeItem('userProfile');
  diagResult.classList.add('hidden');
  renderOffers(allData);
});

/* ---------- SYNTHESIS / "personality" style ---------- */
const synthesis = {
  maturite: {
    idee: "Tu es au stade de l'idée : l'essentiel est d'explorer rapidement la valeur et de tester un concept simple.",
    prototype: "Ton projet est en mode prototype : tu as commencé à tester, l'objectif est d'itérer et valider.",
    amorçage: "Phase d'amorçage : structurer l'offre, sécuriser premiers financements et partenariats.",
    developpement: "Tu es en développement / montée en échelle : objectifs : financement, structuration & distribution."
  },
  besoin: {
    financier: "Priorité : financement — subventions, bourses ou aides qui sécurisent la trésorerie.",
    accompagnement: "Priorité : accompagnement — mentorat, ingénierie de projet, accélération.",
    outil: "Priorité : outils & services — accès à solutions tech, ateliers, bootcamps.",
    visibilite: "Priorité : visibilité & réseau — partenariats, communication, mise en relation."
  },
  previous_support: {
    true: "Tu as déjà bénéficié de dispositifs — certaines aides peuvent être non cumulables. On affine les offres compatibles.",
    false: "Pas (encore) de soutien antérieur — tu es éligible à beaucoup d'opportunités d'entrée de gamme.",
    unknown: "Support antérieur incertain — on affichera les options les plus permissives et l'indicatif."
  }
};

function showProfileSummary(profile) {
  diagResult.innerHTML = `
    <div class="center">
      <div class="summary">
        <h3>🧭 Résumé rapide</h3>
        <p>${synthesis.maturite[profile.maturite] || ''}</p>
        <p>${synthesis.besoin[profile.besoin] || ''}</p>
        <p>${synthesis.previous_support[profile.previous_support] || ''}</p>
        <p class="muted">Besoin estimé : ${profile.echeance || 'non précisé'}. Statut : ${profile.statut || 'non précisé'}.</p>
        <div style="margin-top:.6rem;display:flex;gap:.5rem">
          <button id="view-offers" class="btn-primary">Voir les offres correspondant à mon profil</button>
          <button id="edit-diag" class="btn-ghost">Modifier mes réponses</button>
        </div>
      </div>
    </div>
  `;
  diagResult.classList.remove('hidden');

  document.getElementById('view-offers').addEventListener('click', () => {
    const filtered = filterByProfile(profile);
    renderOffers(filtered);
    document.getElementById('offers').scrollIntoView({behavior:'smooth', block:'start'});
  });
  document.getElementById('edit-diag').addEventListener('click', () => {
    document.getElementById('diagnostic').scrollIntoView({behavior:'smooth'});
  });
}

/* ---------- FILTER logic ---------- */
function filterByProfile(profile) {
  // Flatten calls with their source to filter easier
  const results = [];
  const now = new Date();

  allData.forEach(source => {
    (source.calls || []).forEach(call => {
      // eligibility: previous_support can be true/false/null
      const elig = call.eligibility && typeof call.eligibility.previous_support !== 'undefined' ? call.eligibility.previous_support : null;
      if(profile.previous_support === 'true' && elig === false) {
        // user has previous support but offer forbids previous support => skip
        return;
      }
      if(profile.previous_support === 'false' && elig === true) {
        // offer requires previous support but user doesn't have it => skip
        return;
      }

      // stage filter: offer.stage should be <= or matching user's stage logic
      // We'll match exact stage or close ones by simple rule: allow if call.stage === profile.maturite or call.stage === 'idee' when user is prototype etc.
      const stageOk = simpleStageMatch(profile.maturite, call.stage);

      // need filter: check if call.tags includes profile.besoin OR source.tags includes it
      const tags = (call.tags || []).concat(source.tags || []);
      const needOk = tags.map(t => t.toLowerCase()).includes((profile.besoin || '').toLowerCase());

      // deadline filter: if user needs immediate and call.deadline is far -> deprioritize (we simply filter)
      let deadlineOk = true;
      if(profile.echeance) {
        const callDate = new Date(call.deadline);
        const days = (callDate - now) / (1000*60*60*24);
        if(profile.echeance === 'now' && days > 30) deadlineOk = false;
        if(profile.echeance === '1month' && days > 60) deadlineOk = false;
        if(profile.echeance === '3months' && days > 120) deadlineOk = false;
      }

      if(stageOk && needOk && deadlineOk) {
        results.push({ source, call });
      }
    });
  });

  // return results grouped by source (like original structure)
  const grouped = {};
  results.forEach(it => {
    if(!grouped[it.source.name]) grouped[it.source.name] = { ...it.source, calls: [] };
    grouped[it.source.name].calls.push(it.call);
  });
  return Object.values(grouped);
}

function simpleStageMatch(userStage, offerStage){
  // Normalize
  const order = ['idee','prototype','amorçage','developpement'];
  const ui = order.indexOf(userStage);
  const oi = order.indexOf(offerStage);
  if(ui === -1 || oi === -1) return true; // unknown -> be permissive
  // Allow offers targeting same stage or one step earlier/later
  return Math.abs(ui - oi) <= 1;
}

/* ---------- RENDER OFFERS ---------- */
const cardsContainer = document.getElementById('cards');

function renderOffers(sources) {
  cardsContainer.innerHTML = '';
  if(!sources || sources.length === 0) {
    cardsContainer.innerHTML = '<p class="muted">Aucune offre trouvée pour vos critères. Essaie d’élargir le diagnostic ou supprime les filtres.</p>';
    return;
  }

  sources.forEach(source => {
    (source.calls || []).forEach(call => {
      const el = buildOfferCard(call, source);
      cardsContainer.appendChild(el);
    });
  });
}

function buildOfferCard(call, source) {
  const card = document.createElement('div');
  card.className = 'card offer';
  // selected highlight
  const itemId = `${source.name}::${call.title}`;
  if(wishlist.some(i => i.id === itemId)) card.classList.add('selected');

  card.innerHTML = `
    <h2>${call.title}</h2>
    <p class="muted">${source.name} • ${call.note}</p>
    <p class="meta">📅 ${call.deadline} • ${call.stage ? call.stage.toUpperCase() : ''}</p>
  `;

  // tags
  const tagWrap = document.createElement('div');
  const allTags = (source.tags || []).concat(call.tags || []);
  if(call.stage) allTags.push(call.stage);
  Array.from(new Set(allTags)).forEach(t => {
    const span = document.createElement('span');
    span.className = 'tag';
    span.textContent = t;
    tagWrap.appendChild(span);
  });
  card.appendChild(tagWrap);

  // actions area
  const actions = document.createElement('div');
  actions.style.marginTop = '0.6rem';
  const link = document.createElement('a');
  link.href = call.url;
  link.target = '_blank';
  link.textContent = 'Voir le projet';
  actions.appendChild(link);

  const addBtn = document.createElement('button');
  addBtn.className = 'wishlist-btn';
  addBtn.style.marginLeft = '0.6rem';
  addBtn.textContent = wishlist.some(i => i.id === itemId) ? '⭐ Retirer' : '⭐ Ajouter';
  addBtn.addEventListener('click', () => {
    toggleWishlist(call, source.name, addBtn, card);
  });
  actions.appendChild(addBtn);

  // eligibility small note
  if(call.eligibility && typeof call.eligibility.previous_support !== 'undefined') {
    const p = document.createElement('div');
    p.className = 'muted';
    const prev = call.eligibility.previous_support;
    if(prev === false) p.textContent = '⚠️ Non cumulable avec un soutien préalable';
    if(prev === true) p.textContent = 'ℹ️ Réservé aux projets ayant déjà reçu un soutien';
    actions.appendChild(p);
  }

  card.appendChild(actions);
  return card;
}

/* ---------- WISHLIST ---------- */
const wishlistList = document.getElementById('wishlist-list');
function renderWishlist(){
  wishlistList.innerHTML = '';
  wishlist.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.title} — ${item.source}`;
    wishlistList.appendChild(li);
  });
}

// toggle wishlist
function toggleWishlist(call, sourceName, btn, cardEl){
  const id = `${sourceName}::${call.title}`;
  const idx = wishlist.findIndex(i => i.id === id);
  if(idx === -1){
    // attach current userProfile meta if present
    const meta = userProfile ? { userProfile } : {};
    wishlist.push({ ...call, source: sourceName, id, meta });
    btn.textContent = '⭐ Retirer';
    cardEl.classList.add('selected');
  } else {
    wishlist.splice(idx,1);
    btn.textContent = '⭐ Ajouter';
    cardEl.classList.remove('selected');
  }
  localStorage.setItem('wishlist', JSON.stringify(wishlist));
  renderWishlist();
}

/* ---------- PDF Export ---------- */
document.getElementById('download-wishlist').addEventListener('click', () => {
  if(!wishlist || wishlist.length === 0) return alert('Ta sélection est vide !');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = 15;
  doc.setFontSize(14); doc.text('Sélection — ProjetMatch', 15, y); y += 8;
  if(userProfile){
    doc.setFontSize(10);
    doc.text(`Profil résumé: ${userProfile.maturite || ''} • ${userProfile.besoin || ''} • échéance: ${userProfile.echeance || 'non précisé'}`, 15, y); y += 8;
  }
  wishlist.forEach((it, idx) => {
    doc.setFontSize(12); doc.text(`${idx+1}. ${it.title}`, 15, y); y += 6;
    doc.setFontSize(10); doc.text(`Structure : ${it.source}`, 15, y); y += 5;
    doc.text(`Date limite : ${it.deadline}`, 15, y); y += 5;
    doc.text(`Tags : ${(it.tags||[]).join(', ')} | Stage : ${it.stage || ''}`, 15, y); y += 5;
    if(it.meta && it.meta.userProfile){
      doc.text(`Profil utilisateur : ${it.meta.userProfile.maturite} / ${it.meta.userProfile.besoin} / ${it.meta.userProfile.echeance}`, 15, y); y += 5;
    }
    y += 4;
    if(y > 270){ doc.addPage(); y = 15; }
  });
  doc.save('selection_projetmatch.pdf');
});

/* ---------- MINI FILTER UI ---------- */
document.getElementById('filter-stage').addEventListener('change', () => {
  const s = document.getElementById('filter-stage').value;
  const n = document.getElementById('filter-need').value;
  // recreate a pseudo-profile to filter
  const profile = { maturite: s || undefined, besoin: n || undefined, previous_support: 'unknown', echeance: null };
  const filtered = filterByProfile(profile);
  renderOffers(filtered);
});
document.getElementById('filter-need').addEventListener('change', () => {
  const s = document.getElementById('filter-stage').value;
  const n = document.getElementById('filter-need').value;
  const profile = { maturite: s || undefined, besoin: n || undefined, previous_support: 'unknown', echeance: null };
  const filtered = filterByProfile(profile);
  renderOffers(filtered);
});
document.getElementById('clear-filters').addEventListener('click', () => {
  document.getElementById('filter-stage').value = '';
  document.getElementById('filter-need').value = '';
  renderOffers(allData);
});

/* ---------- INIT ---------- */
loadData();
