"""Exercise real Chromium File System handles; never touches the user's vault."""
import sys
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto(sys.argv[1].rstrip('/') + '/saymore/card-demo/')
    result = page.evaluate('''async () => {
      const {FolderStore, readText, writeFile} = await import('/saymore/cards/storage.mjs');
      const {newCard, editCard, rateCard} = await import('/saymore/cards/model.mjs');
      const assert = (ok, message) => { if (!ok) throw Error(message); };
      const rejects = async fn => { try { await fn(); return false; } catch { return true; } };
      const root = await navigator.storage.getDirectory();
      const vault = await root.getDirectoryHandle(crypto.randomUUID(), {create:true});
      await writeFile(vault, 'existing-note.md', 'unrelated vault note');
      const store = await FolderStore.open(vault);
      const field = {type:'basic',deck:'first',front:'a drink',answer:'coffee'};
      const a = newCard(field), b = newCard({...field,answer:'tea'});
      await store.commit({...store.library,cards:[a,b]}, {}, [a.id,b.id]);
      const saved = await FolderStore.open(vault);
      assert(saved.library.cards.length === 2, 'two cards survive reload');
      assert(await readText(vault,'existing-note.md') === 'unrelated vault note', 'vault files preserved');
      const reviewed = rateCard(saved.library.cards[0],4);
      await saved.commit({...saved.library,cards:[reviewed,b]}, {}, [a.id]);
      assert(await rejects(()=>store.commit({...store.library,cards:[b]}, {}, [])), 'stale writer must fail');
      const notePath = `notes/${a.id}.md`;
      await writeFile(saved.folder,notePath,(await readText(saved.folder,notePath))+'MY EXTRA MEMO');
      const edited=editCard(reviewed,{...field,memory:'my café'});
      await saved.commit({...saved.library,cards:[edited,b]}, {}, [a.id]);
      assert((await readText(saved.folder,notePath)).endsWith('MY EXTRA MEMO'), 'Obsidian memo survives');
      assert(saved.library.cards[0].reviews.length === 1, 'edit does not reset or increase review count');
      const imagePath=`media/${crypto.randomUUID()}.jpg`;
      const picture=newCard({...field,type:'picture',image:{path:imagePath,credit:'test'}});
      assert(await rejects(()=>saved.commit({...saved.library,cards:[...saved.library.cards,picture]}, {}, [picture.id])), 'missing media refused');
      await saved.commit({...saved.library,cards:[...saved.library.cards,picture]}, {[imagePath]:new Blob(['test image'])}, [picture.id]);
      assert((await saved.readMedia(imagePath)).size === 10, 'media copied');
      const left=await FolderStore.open(vault), right=await FolderStore.open(vault);
      const c=newCard({...field,answer:'milk'}), d=newCard({...field,answer:'water'});
      const simultaneous=await Promise.allSettled([
        left.commit({...left.library,cards:[...left.library.cards,c]}, {}, [c.id]),
        right.commit({...right.library,cards:[...right.library.cards,d]}, {}, [d.id])
      ]);
      assert(simultaneous.filter(r=>r.status==='fulfilled').length === 1, 'simultaneous saves cannot lose an update');
      const current=await FolderStore.open(vault);
      const before=await readText(current.folder,'library.json');
      const original=FileSystemFileHandle.prototype.createWritable;
      FileSystemFileHandle.prototype.createWritable=function(options) {
        if (this.name === 'library.json') throw new DOMException('test denial','NotAllowedError');
        return original.call(this,options);
      };
      assert(await rejects(()=>current.commit({...current.library,cards:[b]}, {}, [])), 'failed write reported');
      FileSystemFileHandle.prototype.createWritable=original;
      assert(await readText(current.folder,'library.json') === before, 'failed save preserves disk');
      assert(current.library.cards.length === 4, 'failed save preserves memory');
      FileSystemFileHandle.prototype.createWritable=function(options) {
        if (this.name.endsWith('.md')) throw new DOMException('test note denial','NotAllowedError');
        return original.call(this,options);
      };
      const modified=editCard(current.library.cards[1],{...field,answer:'green tea'});
      const changed=current.library.cards.map(c=>c.id===modified.id ? modified:c);
      const outcome=await current.commit({...current.library,cards:changed}, {}, [modified.id]);
      FileSystemFileHandle.prototype.createWritable=original;
      assert(outcome.warnings.length === 1, 'note failure distinguished from committed card');
      assert(current.library.cards[1].answer === 'green tea', 'canonical save committed');
      assert((await current.exportNotes()).warnings.length === 0, 'note repair succeeds without extra reviews');
      assert((await readText(current.folder,`notes/${modified.id}.md`)).includes('green tea'), 'repair exports committed content');
      const backup=JSON.parse(await readText(current.folder,'library.backup.json'));
      assert(backup.cards.length === 4, 'previous valid snapshot retained');
      await writeFile(current.folder,'library.json','broken JSON');
      assert(await rejects(()=>FolderStore.open(vault)), 'corrupt library rejected');
      assert(await readText(current.folder,'library.json') === 'broken JSON', 'corrupt original not overwritten');
      return 'PASS: multi-card persistence, media, separate schedules, memo preservation, stale/concurrent writes, failures, backup';
    }''')
    print(result)
    browser.close()
