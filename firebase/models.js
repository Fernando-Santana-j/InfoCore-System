
const db = require('./db.js')

module.exports = {
    findAll: async (props) => {
        const snap = await db.collection(props.colecao).get();
        return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
    },

    findOne: async (props) => {
        let firebaseData = db.collection(props.colecao)
        if (props.hasOwnProperty('doc')) {
            firebaseData = firebaseData.doc(props.doc)
        }
        if (props.hasOwnProperty('where')) {
            firebaseData = firebaseData.where(props.where[0] ,props.where[1],props.where[2])
        }
        return await firebaseData.get().then(async (res) => {
            let data 
            if (props.hasOwnProperty('where')) {
                if (res.docs.length > 0) {
                    const doc = res.docs[0]
                    data = { ...doc.data(), id: doc.id }
                }else{
                    return {error:true,err:'Nenhum dado encontrado'}
                }
            }else{
                data = { ...res.data(), id: res.id }
            }
            data.error = false
            return data
        }).catch((error) => {
            return {error:true,err:error}
            console.error('Erro ao buscar dados do Firestore:', error);
        });

    },
    update: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        let res = await firebaseData.update(data);
        return res
    },
    delete: async (colecao, doc,) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await firebaseData.delete();
        return
    },
    create: async (colecao, doc, data) => {
        let firebaseData = db.collection(colecao).doc(doc)
        await firebaseData.set(data);
        return
    }
}