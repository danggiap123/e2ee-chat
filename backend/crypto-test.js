const _sodium = require('libsodium-wrappers'); //import thư viện libsodium-wrappers để sử dụng các hàm mã hóa
async function main() {
    await _sodium.ready; //chờ thư viện sẵn sàng trước khi sử dụng
    const sodium = _sodium;
    console.log("====== Crypto Test ====");

    //phần 1: sinh key pair
    // alice là người gửi, bob là người nhận
    // Các khóa khác nhau về vai trò, giống nhau về cấu trúc nên được khai báo giống nhau, chỉ khác tên biến để dễ phân biệt, đều là X25519 key pair (publicKey, privateKey)

    //ik =identity key(khóa dài hạn, dùng để xác thực danh tính)
    const aliceIK = sodium.crypto_box_keypair(); //{publicKey, privateKey} , các khóa sinh ra dưới dạng Uint8Array, có độ dài 32 byte (256 bit) cho private key và 32 byte cho public key
    const bobIK = sodium.crypto_box_keypair();

    //ek = ephemeral key(khóa ngắn hạn, dùng để mã hóa tin nhắn, mỗi tin nhắn sẽ có một ek khác nhau, đảm bảo forward secrecy,không tai sử dụng lại ek)
    const aliceEK = sodium.crypto_box_keypair();

    //spk = signed prekey
    const bobSPK = sodium.crypto_box_keypair();

    //opk = one-time prekey
    const bobOPK = sodium.crypto_box_keypair();

    console.log("Sinh key pair thành công!");
    console.log('Alice IK pub:', Buffer.from(aliceIK.publicKey).toString('hex').slice(0, 16), '...'); //in ra 16 ký tự đầu của public key của Alice để kiểm tra
    console.log('Bob IK pub:', Buffer.from(bobIK.publicKey).toString('hex').slice(0, 16), '...'); //in ra 16 ký tự đầu của public key của Bob để kiểm tra
    console.log('Alice EK pub:', Buffer.from(aliceEK.publicKey).toString('hex').slice(0, 16), '...'); //in ra 16 ký tự đầu của public key của Alice EK để kiểm tra
    console.log('Bob SPK pub:', Buffer.from(bobSPK.publicKey).toString('hex').slice(0, 16), '...');

    //phần 2: x3dh - 4 phép DH để tạo shared secret
    const dh1 = sodium.crypto_scalarmult(aliceIK.privateKey, bobSPK.publicKey); //DH1: Alice IK x Bob SPK
    const dh2 = sodium.crypto_scalarmult(aliceEK.privateKey, bobIK.publicKey); //DH2: Alice EK x Bob IK
    const dh3 = sodium.crypto_scalarmult(aliceEK.privateKey, bobSPK.publicKey); //DH3: Alice EK x Bob SPK
    const dh4 = sodium.crypto_scalarmult(aliceEK.privateKey, bobOPK.publicKey); //DH4: Alice EK x Bob OPK  

    //kết hợp 4 shared secret lại thành KM (key material)
    const KM = Buffer.concat([
        Buffer.from(dh1), //DH1
        Buffer.from(dh2), //DH2
        Buffer.from(dh3), //DH3
        Buffer.from(dh4)  //DH4
    ]);
    console.log("Tạo shared secret thành công!");
    console.log('KM:', KM.toString('hex').slice(0, 32), '...'); //in ra 16 byte đầu của KM để kiểm tra
    console.log('KM length:', KM.length); //in ra độ dài của KM để kiểm tra, phải là 128 byte (4 x 32 byte)

    //phần 3: HKDF-SHA256: Extract entropy từ IKM, Expand thành Session Key 32 byte
    // F = 0xFF theo signal spec (phân biệt x25519 với x448)
    const F = Buffer.alloc(32, 0xFF); //tạo buffer 32 byte với giá trị 0xFF

    // Input key material = F || KM
    const IKM = Buffer.concat([F, KM]);

    // Web Crypto không nhận byte thô trực tiếp. Phải "import" vào thành CryptoKey object trước mới dùng được.
    // Web Crypto API — import IKM thành CryptoKey (object) để dùng được HKDF
    const rawKey = await crypto.subtle.importKey(
        'raw',         // format: dạng thô (byte) 
        IKM,           // key material ở dạng thô
        'HKDF',        // thuật toán sẽ dùng rawKey này sau hàm này sẽ trở thành CryptoKey dùng cho HKDF
        false,         // extractable: false = không cho export ra ngoài
        ['deriveKey']  // chỉ dùng để deriveKey, không dùng việc khác
    );

    // Derive Session Key 32 byte bằng HKDF-SHA256, output là cryptoKey dùng để mã hóa tin nhắn sau này (SK)
    const sessionCryptoKey = await crypto.subtle.deriveKey(
        // Cấu hình thuật toán HKDF, theo Signal spec: hash=SHA-256, salt=32 byte 0x00, info='X3DH'
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: new Uint8Array(32),// salt: chuỗi 0x00 độ dài bằng output hash (32 byte) — theo Signal spec
            info: new TextEncoder().encode('X3DH'), // nhãn, convert string→byte
        },
        rawKey, // input key (CryptoKey object) đã import ở bước trước
        { name: 'AES-GCM', length: 256 }, // output là AES-256 key ở dạng CryptoKey object
        true,           // extractable: true = cho phép export để xem/dùng
        ['encrypt', 'decrypt']
    );

    // Export session key ra để xem (dạng raw byte)
    const sessionKey = Buffer.from(await crypto.subtle.exportKey('raw', sessionCryptoKey)); //hàm exportKey trả về ArrayBuffer, convert sang Buffer để dễ xem

    console.log('\n✅ HKDF derive Session Key xong');
    console.log('   Session Key:', sessionKey.toString('hex').slice(0, 32), '...');
    console.log('   Session Key length:', sessionKey.length, 'bytes (phải là 32)');

    //phần 4: AES-GCM encrypt/decrypt test

    // IV = Initialization Vector: 12 byte ngẫu nhiên, bắt buộc mỗi tin nhắn dùng IV khác nhau
    // Nếu dùng lại IV với cùng key → attacker có thể phá vỡ mã hóa hoàn toàn
    const iv = crypto.getRandomValues(new Uint8Array(12)); //output là Uint8Array 12 byte, dùng làm IV cho AES-GCM

    // AAD = Additional Authenticated Data: dữ liệu không mã hóa nhưng được xác thực
    // Mục đích: chống tamper — nếu ai sửa senderId/receiverId → decrypt sẽ fail, convert string -> byte để làm AAD cho AES-GCM
    const aad = new TextEncoder().encode(JSON.stringify({
        senderId: 'alice',
        receiverId: 'bob',
    }));

    // Tin nhắn gốc
    const plaintext = new TextEncoder().encode('Xin chào Bob, đây là tin nhắn bí mật!');//convert string → byte để mã hóa bằng AES-GCM, web crypto chỉ mã hóa được byte, nên phải convert string → byte trước khi mã hóa, sau khi giải mã sẽ convert ngược lại byte → string để đọc được nội dung

    // Encrypt, output ở dạng ArrayBuffer  
    const ciphertext = await crypto.subtle.encrypt(
        {
            name: 'AES-GCM',
            iv: iv,             // IV 12 byte
            additionalData: aad // AAD đưa vào đây
        },
        sessionCryptoKey,     // CryptoKey object từ Phần 3
        plaintext             // dữ liệu cần mã hóa
    );

    console.log('\n✅ Encrypt xong');
    console.log('   Plaintext length:', plaintext.byteLength, 'bytes');
    console.log('   Ciphertext length:', ciphertext.byteLength, 'bytes');
    // AES-GCM tự thêm 16 byte auth tag vào cuối ciphertext
    // nên ciphertext dài hơn plaintext đúng 16 byte

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
        {
            name: 'AES-GCM',
            iv: iv,             // phải dùng đúng IV đã encrypt
            additionalData: aad // phải dùng đúng AAD đã encrypt
        },
        sessionCryptoKey,     // cùng key
        ciphertext
    );

    const decryptedText = new TextDecoder().decode(decrypted);

    console.log('✅ Decrypt xong');
    console.log('   Plaintext gốc:  ', 'Xin chào Bob, đây là tin nhắn bí mật!');
    console.log('   Plaintext sau decrypt:', decryptedText);
    console.log('   Khớp nhau:', decryptedText === 'Xin chào Bob, đây là tin nhắn bí mật!');
}
main().catch(console.error);