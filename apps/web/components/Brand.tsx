export function Logo() {
  return (
    <span className="logo-chip">
      <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/doowon-logo.png`} alt="Doowon" />
    </span>
  );
}
