import bcrypt from 'bcryptjs';
import {createInterface} from 'node:readline';
const rl=createInterface({input:process.stdin,output:process.stdout});
rl.question('New login password: ',async password=>{if(password.length<12){console.error('Use at least 12 characters.');process.exitCode=1;}else console.log('Set ADMIN_PASSWORD_HASH to:\n'+await bcrypt.hash(password,12));rl.close();});
