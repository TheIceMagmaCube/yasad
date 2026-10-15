// No 0/O, 1/l/I: the password is read off a screen and typed again.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LENGTH = 20;

/**
 * Return a random password for an account created or reset by an admin.
 *
 * Bytes above the largest multiple of the alphabet size are drawn again, so every character is
 * equally likely.
 */
export function temporaryPassword(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let password = "";
  while (password.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(LENGTH))) {
      if (byte < limit && password.length < LENGTH) password += ALPHABET[byte % ALPHABET.length];
    }
  }
  return password;
}
