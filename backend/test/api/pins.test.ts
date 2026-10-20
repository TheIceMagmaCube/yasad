import { describe, expect, it } from "vitest";

import { adminApp, importFile } from "./catalog-items";
import { catalog, localUser } from "./home-catalog";

describe("user_link_pin", () => {
  it("cascades from the user and from the link", async () => {
    const admin = await adminApp();
    await importFile(
      admin,
      catalog([{ id: "c", groups: ["@everyone"], links: [{ id: "l1", groups: ["@everyone"] }, { id: "l2", groups: ["@everyone"] }] }]),
    );
    await localUser(admin, "b");
    await admin.exec(`insert into user_link_pin (user_id, link_id, position) values ('ada', 'l1', 0), ('b', 'l2', 0)`);
    expect(await admin.query(`select user_id, link_id, position from user_link_pin where user_id = 'ada'`)).toEqual([
      { user_id: "ada", link_id: "l1", position: 0 },
    ]);
    await admin.exec(`delete from link where id = 'l1'`);
    await admin.exec(`delete from user where id = 'b'`);
    expect(await admin.query(`select * from user_link_pin`)).toEqual([]);
  });
});
