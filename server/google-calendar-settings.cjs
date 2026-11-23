'use strict';
// Private settings contract. Registering secrets never enables the connection.
function calendarSettings(env={}){
 if(env.GOOGLE_CALENDAR_ENABLED!=='true')return null;
 const fail=()=>{throw Error('CALENDAR_SETTINGS_INCOMPLETE')};
 const key=name=>{const value=env[name];if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))return fail();return Buffer.from(value,'hex')};
 const clientId=env.GOOGLE_CALENDAR_CLIENT_ID,clientSecret=env.GOOGLE_CALENDAR_CLIENT_SECRET;
 if(typeof clientId!=='string'||!/^[A-Za-z0-9_-]{5,200}\.apps\.googleusercontent\.com$/.test(clientId)||typeof clientSecret!=='string'||clientSecret.length<16||clientSecret.length>512||/[^\x21-\x7e]/.test(clientSecret))return fail();
 let metadata;try{metadata=JSON.parse(env.MYINVEST_EXPECTED_METADATA)}catch{return fail()}
 if(!metadata||metadata.freshTestEnvironment!==true||metadata.testEnvironment!=='nh-staging'||![metadata.scriptHash,metadata.sheetHash].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)))return fail();
 return {clientId,clientSecret,bridgeKey:key('CALENDAR_IDENTITY_BRIDGE_KEY'),encryptionKey:key('GOOGLE_CALENDAR_ENCRYPTION_KEY'),scriptHash:metadata.scriptHash,sheetHash:metadata.sheetHash};
}
module.exports={calendarSettings};
