"""
AES-256-CBC file encryption for uploaded portfolio files.
Key is loaded from the FILE_ENCRYPTION_KEY environment variable.
"""

from __future__ import annotations

import os
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend


def encrypt_file(plaintext: bytes, output_path: str, key: bytes) -> None:
    """Encrypt `plaintext` with AES-256-CBC and write to `output_path`."""
    iv = os.urandom(16)
    # Pad to 16-byte boundary (PKCS7)
    pad_len = 16 - (len(plaintext) % 16)
    padded = plaintext + bytes([pad_len] * pad_len)

    cipher = Cipher(algorithms.AES(key[:32]), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    with open(output_path, "wb") as f:
        f.write(iv + ciphertext)


def decrypt_file(input_path: str, key: bytes) -> bytes:
    """Read and decrypt an AES-256-CBC encrypted file. Returns plaintext bytes."""
    with open(input_path, "rb") as f:
        data = f.read()

    iv, ciphertext = data[:16], data[16:]
    cipher = Cipher(algorithms.AES(key[:32]), modes.CBC(iv), backend=default_backend())
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()

    # Remove PKCS7 padding
    pad_len = padded[-1]
    return padded[:-pad_len]
