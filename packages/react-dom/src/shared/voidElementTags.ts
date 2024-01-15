import omittedCloseTags from "./omittedCloseTags"

// For HTML, certain tags cannot have children. This has the same purpose as
// `omittedCloseTags` except that `menuitem` should still have its closing tag.

const voidElementTags: Record<string, any> = {
  menuitem: true,
  ...omittedCloseTags,
}

export default voidElementTags
