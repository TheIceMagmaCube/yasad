import { useInstance } from "../instance";
import { Logo } from "./Logo";

/** Draw the instance logo, or the YASAD logo when none is set. Decorative: the title sits next to it. */
export function InstanceLogo({ className }: { className?: string }) {
  const { logo } = useInstance();
  return logo ? <img src={logo} alt="" className={className} /> : <Logo className={className} />;
}
