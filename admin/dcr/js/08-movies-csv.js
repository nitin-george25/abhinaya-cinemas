/*
 * 08-movies-csv.js
 * Phase A refactor: extracted verbatim from index.html.
 * Movies CSV bulk upload (block #7)
 *
 * Phase B notes:
 *   - Convert to ES module: replace globals with explicit import/export.
 *   - Pure functions (no DOM) → keep / move to js/engine/.
 *   - Render functions (touch DOM) → keep in this layer; become components later.
 */

(function(){
  function ready(fn){ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', fn); else fn(); }
  ready(function(){
    var pending = null;

    function parseCSV(text){
      var rows=[], i=0, cell='', row=[], inQ=false;
      while(i<text.length){
        var c=text[i];
        if(inQ){
          if(c==='"' && text[i+1]==='"'){ cell+='"'; i+=2; continue; }
          if(c==='"'){ inQ=false; i++; continue; }
          cell+=c; i++; continue;
        }
        if(c==='"'){ inQ=true; i++; continue; }
        if(c===','){ row.push(cell); cell=''; i++; continue; }
        if(c==='\r'){ i++; continue; }
        if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; i++; continue; }
        cell+=c; i++;
      }
      if(cell.length || row.length){ row.push(cell); rows.push(row); }
      return rows;
    }
    function normDate(d){
      d = String(d||'').trim();
      if(!d) return '';
      if(/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      var m = d.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
      if(m){ var y = parseInt(m[3],10); if(y<100) y += 2000; return y+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'); }
      return '';
    }
    function escHtml(v){ return String(v==null?'':v).replace(/[&<>"']/g, function(c){return ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[c];}); }

    function parseMoviesCSV(text){
      // strip lines beginning with '#'
      text = text.split(/\r?\n/).filter(function(l){return !/^\s*#/.test(l);}).join('\n');
      var rows = parseCSV(text);
      if(!rows.length) throw new Error('CSV is empty.');
      var hi = -1;
      for(var i=0;i<rows.length;i++){
        var lc = rows[i].map(function(x){return (x||'').trim().toLowerCase();});
        if(lc.indexOf('name')>=0) { hi = i; break; }
      }
      if(hi<0) throw new Error('Header row not found (need a "Name" column).');
      var H = rows[hi].map(function(h){return (h||'').trim().toLowerCase();});
      function col(k){ return H.indexOf(k); }
      var iName = col('name');
      var iDist = col('distributor');
      var iRel  = col('release date'); if(iRel<0) iRel = col('release');
      var iShr  = col('share %');      if(iShr<0) iShr = col('share');
      if(iName<0) throw new Error('Missing "Name" column.');

      var added = [], updated = [], errors = [];
      for(var r=hi+1; r<rows.length; r++){
        var row = rows[r];
        if(!row || !row.some(function(v){return (v||'').trim();})) continue;
        var name = (row[iName] || '').trim();
        if(!name){ continue; }
        var dist = iDist>=0 ? (row[iDist] || '').trim() : '';
        var rel  = iRel >=0 ? normDate(row[iRel]) : '';
        var shrRaw = iShr >=0 ? (row[iShr] || '').toString().trim() : '';
        var shr = shrRaw==='' ? null : Number(shrRaw);
        if(shrRaw!=='' && !isFinite(shr)){ errors.push('Row '+(r+1)+': bad share value "'+shrRaw+'"'); continue; }
        var existing = (S.movies||[]).find(function(m){ return String(m.name||'').trim().toLowerCase() === name.toLowerCase(); });
        if(existing){
          updated.push({existing: existing, fields: {name: name, distributor: dist || existing.distributor || '', release: rel || existing.release || '', share: shr==null ? (existing.share==null?50:existing.share) : shr}});
        } else {
          added.push({name: name, distributor: dist, release: rel, share: shr==null ? 50 : shr});
        }
      }
      return { added: added, updated: updated, errors: errors };
    }

    document.addEventListener('click', function(e){
      if(e.target.id==='moviesBulkTemplate'){
        var csv = 'Name,Distributor,Release Date,Share %\n'
                + '# Required: Name. Other columns are optional and update existing movies if blank is replaced.\n'
                + '# Release Date format: YYYY-MM-DD (also accepts DD-MM-YYYY).\n'
                + '# Share % default = 50 when blank on a new movie.\n';
        var blob = new Blob([csv], {type:'text/csv'});
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'movies_template.csv'; a.click();
      }
      if(e.target.id==='moviesBulkSample'){
        var csv = 'Name,Distributor,Release Date,Share %\n'
                + 'Empuraan,Ashirvad Cinemas,2026-03-27,60\n'
                + 'Dhurandhar,PVR Inox Pictures,2026-03-18,55\n'
                + 'Vaazha 2,Icon Cinemas,2026-04-02,50\n';
        var blob = new Blob([csv], {type:'text/csv'});
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'movies_sample.csv'; a.click();
      }
      if(e.target.id==='moviesBulkUpload'){
        document.getElementById('moviesBulkFile').click();
      }
      if(e.target.id==='moviesBulkImport'){
        if(!pending) return;
        var nAdd = pending.added.length;
        var nUpd = pending.updated.length;
        if(!nAdd && !nUpd) return;
        if(!confirm('Import '+nAdd+' new movie(s) and update '+nUpd+' existing one(s)?')) return;
        // Apply
        pending.added.forEach(function(p){
          S.movies.push({id: uid(), name: p.name, distributor: p.distributor || '', release: p.release || '', share: p.share});
        });
        pending.updated.forEach(function(u){
          u.existing.name = u.fields.name;
          u.existing.distributor = u.fields.distributor;
          u.existing.release = u.fields.release;
          u.existing.share = u.fields.share;
        });
        save();
        renderMovies();
        document.getElementById('moviesBulkPreview').innerHTML = '<span style="color:#2a8">✓ Imported. '+nAdd+' added, '+nUpd+' updated.</span>';
        document.getElementById('moviesBulkImport').style.display = 'none';
        pending = null;
      }
    });

    document.addEventListener('change', function(e){
      if(e.target.id!=='moviesBulkFile') return;
      var f = e.target.files && e.target.files[0]; if(!f) return;
      var rd = new FileReader();
      rd.onload = function(){
        try {
          var parsed = parseMoviesCSV(rd.result);
          pending = parsed;
          var html = '<b>'+parsed.added.length+' new</b> &middot; <b>'+parsed.updated.length+' will be updated</b>';
          if(parsed.errors.length) html += ' &middot; <span style="color:#c00">'+parsed.errors.length+' error(s)</span>';
          html += '<br><br>';
          if(parsed.added.length){
            html += '<b>New:</b><ul style="margin:4px 0 8px 18px;padding:0">';
            parsed.added.slice(0,40).forEach(function(p){
              html += '<li>'+escHtml(p.name)+(p.distributor?(' — '+escHtml(p.distributor)):'')+(p.release?(' (released '+escHtml(p.release)+')'):'')+' — share '+escHtml(p.share)+'%</li>';
            });
            if(parsed.added.length>40) html += '<li>… +'+(parsed.added.length-40)+' more</li>';
            html += '</ul>';
          }
          if(parsed.updated.length){
            html += '<b>Updated:</b><ul style="margin:4px 0 8px 18px;padding:0">';
            parsed.updated.slice(0,40).forEach(function(u){
              html += '<li>'+escHtml(u.fields.name)+(u.fields.distributor?(' — '+escHtml(u.fields.distributor)):'')+(u.fields.release?(' (released '+escHtml(u.fields.release)+')'):'')+' — share '+escHtml(u.fields.share)+'%</li>';
            });
            if(parsed.updated.length>40) html += '<li>… +'+(parsed.updated.length-40)+' more</li>';
            html += '</ul>';
          }
          if(parsed.errors.length){
            html += '<span style="color:#c00"><b>Errors:</b></span><ul style="margin:4px 0 0 18px">';
            parsed.errors.slice(0,8).forEach(function(s){ html += '<li>'+escHtml(s)+'</li>'; });
            html += '</ul>';
          }
          document.getElementById('moviesBulkPreview').innerHTML = html;
          document.getElementById('moviesBulkImport').style.display = (parsed.added.length || parsed.updated.length) ? '' : 'none';
        } catch(err){
          document.getElementById('moviesBulkPreview').innerHTML = '<span style="color:#c00"><b>Could not read CSV:</b> '+escHtml(err.message)+'</span>';
          document.getElementById('moviesBulkImport').style.display = 'none';
        }
        e.target.value = '';
      };
      rd.readAsText(f);
    });
  });
})();
