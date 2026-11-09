import { ImageCropSheet } from '../../components/ImageCropper';
import { useLibrary } from '../../state/Library';
import { setAvatar } from '../../cloud/remote';

/** Ausschnitt fürs Profilbild wählen: verschieben, zoomen, drehen, spiegeln – dann hochladen. */
export function AvatarSheet({ file, onClose }: { file: File; onClose: () => void }) {
  const { me, profiles, refreshRemote } = useLibrary();
  return (
    <ImageCropSheet
      source={file}
      title="Profilbild"
      confirmLabel="Als Profilbild verwenden"
      out={256}
      round
      note="Alle angemeldeten Personen sehen dein Profilbild – wie deinen Benutzernamen."
      onClose={onClose}
      onDone={async (blob) => {
        if (!me) return;
        const old = profiles.find((p) => p.id === me.id)?.avatarPath;
        await setAvatar(me.id, blob, old);
        await refreshRemote();
        onClose();
      }}
    />
  );
}
