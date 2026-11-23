/* Optional cloud adapter. No Firebase scripts are loaded if configuration is empty.
 * Uses per-topic/per-session documents and Firestore persistent local cache.
 * UI always retains a local mirror for first-load offline use. */
export async function createCloud(config, hooks) {
  if(!config?.apiKey || !config?.authDomain || !config?.projectId || !config?.appId){
    hooks.onStatus('unconfigured');return null;
  }
  const V='13.4.0';
  hooks.onStatus('connecting');
  const [appModule,authModule,dbModule]=await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);
  const app=appModule.initializeApp(config);
  const auth=authModule.getAuth(app);
  let db;
  try{
    db=dbModule.initializeFirestore(app,{localCache:dbModule.persistentLocalCache({tabManager:dbModule.persistentMultipleTabManager()})});
  }catch(error){
    db=dbModule.getFirestore(app);
    hooks.onStatus('cache-limited',error.message);
  }
  let currentUid=null,unsubscribers=[];
  const stop=()=>{unsubscribers.forEach(unsub=>unsub());unsubscribers=[];};
  authModule.onAuthStateChanged(auth, user=>{
    stop();
    currentUid=user?.uid||null;
    hooks.onAuth(user?{uid:user.uid,name:user.displayName||user.email||'Signed in',email:user.email||''}:null);
    if(!user){hooks.onStatus('signed-out');return;}
    hooks.onStatus(navigator.onLine?'syncing':'offline');
    for(const kind of ['topics','logs','preferences']) {
      const ref=dbModule.collection(db,'users',user.uid,kind);
      const un=dbModule.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
        hooks.onCollection(kind,snapshot.docs.map(d=>({id:d.id,...d.data()})),{
          fromCache:snapshot.metadata.fromCache,
          hasPendingWrites:snapshot.metadata.hasPendingWrites
        });
        if(!snapshot.metadata.hasPendingWrites){hooks.onStatus(snapshot.metadata.fromCache?'offline':'synced');}
      },error=>hooks.onStatus('error',error.message));
      unsubscribers.push(un);
    }
  },error=>hooks.onStatus('error',error.message));
  return {
    get uid(){return currentUid;},
    signIn:()=>authModule.signInWithPopup(auth,new authModule.GoogleAuthProvider()),
    signOut:()=>authModule.signOut(auth),
    async write(kind,item){
      if(!currentUid)return;
      const ref=dbModule.doc(db,'users',currentUid,kind,String(item.id));
      await dbModule.setDoc(ref,item);
    }
  };
}
